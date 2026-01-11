let detectedStreams = new Map();
let activeDownloads = new Map();

let ffmpegLoaded = false;
let ffmpeg = null;

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    
    if (url.includes('.m3u8')) {
      const tabId = details.tabId;
      
      if (tabId > 0) {
        if (!detectedStreams.has(tabId)) {
          detectedStreams.set(tabId, []);
        }
        
        const streams = detectedStreams.get(tabId);
        if (!streams.some(s => s.url === url)) {
          streams.push({
            url: url,
            timestamp: Date.now(),
            tabUrl: details.initiator || details.documentUrl
          });
          
          chrome.action.setBadgeText({ text: '●', tabId: tabId });
          chrome.action.setBadgeBackgroundColor({ color: '#00ff88', tabId: tabId });
        }
      }
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  detectedStreams.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    detectedStreams.delete(tabId);
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStreams') {
    const tabId = request.tabId;
    const streams = detectedStreams.get(tabId) || [];
    sendResponse({ streams: streams });
  } else if (request.action === 'getQualityVariants') {
    getQualityVariants(request.streamUrl).then(variants => {
      sendResponse({ variants: variants });
    }).catch(error => {
      sendResponse({ variants: [], error: error.message });
    });
    return true;
  } else if (request.action === 'startDownload') {
    startDownload(request.streamUrl, request.quality, request.qualityUrl, request.tabId, request.audioOnly);
    sendResponse({ success: true });
  } else if (request.action === 'cancelDownload') {
    cancelDownload(request.downloadId);
    sendResponse({ success: true });
  } else if (request.action === 'removeDownload') {
    activeDownloads.delete(request.downloadId);
    sendResponse({ success: true });
  } else if (request.action === 'getActiveDownloads') {
    const downloads = Array.from(activeDownloads.values());
    sendResponse({ downloads: downloads });
  }
  return true;
});

async function getQualityVariants(streamUrl) {
  try {
    const playlistText = await fetchText(streamUrl);
    const variants = parseMasterPlaylist(playlistText, streamUrl);
    
    if (variants.length === 0) {
      return [{
        quality: 'Auto',
        resolution: 'Original',
        bandwidth: 0,
        url: streamUrl
      }];
    }
    
    return variants;
  } catch (error) {
    console.error('Error fetching quality variants:', error);
    return [{
      quality: 'Auto',
      resolution: 'Error',
      bandwidth: 0,
      url: streamUrl
    }];
  }
}

async function startDownload(streamUrl, quality, qualityUrl, tabId, audioOnly = false) {
  const downloadId = generateId();
  
  const downloadInfo = {
    id: downloadId,
    streamUrl: streamUrl,
    quality: quality,
    status: 'initializing',
    progress: 0,
    segmentsDownloaded: 0,
    totalSegments: 0,
    downloadedBytes: 0,
    estimatedSize: 0,
    speed: 0,
    timeRemaining: 0,
    startTime: Date.now(),
    cancelled: false,
    audioOnly: audioOnly
  };
  
  activeDownloads.set(downloadId, downloadInfo);
  
  chrome.tabs.create({
    url: chrome.runtime.getURL('downloader.html') + '?id=' + downloadId
  });
  
  try {
    const targetUrl = qualityUrl || streamUrl;
    const playlistText = await fetchText(targetUrl);
    const segments = parseSegmentPlaylist(playlistText, targetUrl);
    
    downloadInfo.totalSegments = segments.length;
    downloadInfo.status = 'downloading';
    activeDownloads.set(downloadId, downloadInfo);
    
    await downloadSegments(downloadId, segments);
  } catch (error) {
    downloadInfo.status = 'error';
    downloadInfo.error = error.message;
    activeDownloads.set(downloadId, downloadInfo);
  }
}

async function downloadSegments(downloadId, segments) {
  const downloadedSegments = [];
  const startTime = Date.now();
  let lastProgressUpdate = Date.now();
  
  for (let i = 0; i < segments.length; i++) {
    const downloadInfo = activeDownloads.get(downloadId);
    if (!downloadInfo) return;
    
    if (downloadInfo.cancelled) {
      downloadInfo.status = 'cancelled';
      activeDownloads.set(downloadId, downloadInfo);
      broadcastProgress(downloadId);
      return;
    }
    
    try {
      const segmentData = await fetchArrayBuffer(segments[i].url);
      downloadedSegments.push(segmentData);
      
      downloadInfo.segmentsDownloaded = i + 1;
      downloadInfo.downloadedBytes += segmentData.byteLength;
      downloadInfo.progress = ((i + 1) / segments.length) * 100;
      
      const elapsed = (Date.now() - startTime) / 1000;
      downloadInfo.speed = downloadInfo.downloadedBytes / elapsed;
      
      const remainingSegments = segments.length - (i + 1);
      const avgTimePerSegment = elapsed / (i + 1);
      downloadInfo.timeRemaining = remainingSegments * avgTimePerSegment;
      
      downloadInfo.estimatedSize = (downloadInfo.downloadedBytes / (i + 1)) * segments.length;
      
      activeDownloads.set(downloadId, downloadInfo);
      
      if (Date.now() - lastProgressUpdate > 500) {
        broadcastProgress(downloadId);
        lastProgressUpdate = Date.now();
      }
    } catch (error) {
      console.error('Error downloading segment:', error);
    }
  }
  
  const finalInfo = activeDownloads.get(downloadId);
  if (!finalInfo || finalInfo.cancelled) return;
  
  finalInfo.status = 'merging';
  activeDownloads.set(downloadId, finalInfo);
  broadcastProgress(downloadId);
  
  await mergeSegments(downloadId, downloadedSegments);
}

async function mergeSegments(downloadId, segments) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (!downloadInfo) return;
  
  try {
    const mergedBlob = new Blob(segments, { type: 'video/mp2t' });
    
    downloadInfo.status = 'converting';
    downloadInfo.progress = 95;
    activeDownloads.set(downloadId, downloadInfo);
    broadcastProgress(downloadId);
    
    let finalBlob;
    let fileExtension;
    
    try {
      if (downloadInfo.audioOnly) {
        finalBlob = await extractAudio(mergedBlob, downloadId);
        fileExtension = 'mp3';
      } else {
        finalBlob = await convertToMP4(mergedBlob, downloadId);
        fileExtension = 'mp4';
      }
    } catch (conversionError) {
      console.warn('Conversion failed, saving as TS:', conversionError);
      finalBlob = mergedBlob;
      fileExtension = 'ts';
    }
    
    const dataUrl = await blobToDataURL(finalBlob);
    const filename = `video_${downloadInfo.quality}_${Date.now()}.${fileExtension}`;
    
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    }, (downloadItemId) => {
      if (chrome.runtime.lastError) {
        downloadInfo.status = 'error';
        downloadInfo.error = chrome.runtime.lastError.message;
        activeDownloads.set(downloadId, downloadInfo);
        broadcastProgress(downloadId);
      } else {
        downloadInfo.status = 'completed';
        downloadInfo.progress = 100;
        activeDownloads.set(downloadId, downloadInfo);
        broadcastProgress(downloadId);
      }
    });
  } catch (error) {
    downloadInfo.status = 'error';
    downloadInfo.error = error.message;
    activeDownloads.set(downloadId, downloadInfo);
    broadcastProgress(downloadId);
  }
}

async function convertToMP4(tsBlob, downloadId) {
  try {
    const arrayBuffer = await tsBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const mp4Data = await transmuxToMP4(uint8Array);
    
    return new Blob([mp4Data], { type: 'video/mp4' });
  } catch (error) {
    console.error('MP4 conversion error:', error);
    throw new Error('Failed to convert to MP4: ' + error.message);
  }
}

async function extractAudio(tsBlob, downloadId) {
  try {
    const arrayBuffer = await tsBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    await loadMuxJS();
    
    if (!self.muxjs) {
      throw new Error('mux.js library not available');
    }
    
    return new Promise((resolve, reject) => {
      const transmuxer = new self.muxjs.mp4.Transmuxer();
      const audioSegments = [];
      
      transmuxer.on('data', (segment) => {
        if (segment.type === 'audio') {
          if (segment.initSegment) audioSegments.push(segment.initSegment);
          if (segment.data) audioSegments.push(segment.data);
        }
      });
      
      transmuxer.on('done', () => {
        if (audioSegments.length === 0) {
          reject(new Error('No audio data found'));
          return;
        }
        
        const totalLength = audioSegments.reduce((acc, seg) => acc + seg.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        
        for (const segment of audioSegments) {
          result.set(new Uint8Array(segment), offset);
          offset += segment.byteLength;
        }
        
        resolve(new Blob([result], { type: 'audio/mpeg' }));
      });
      
      transmuxer.push(uint8Array);
      transmuxer.flush();
    });
  } catch (error) {
    console.error('Audio extraction error:', error);
    throw new Error('Failed to extract audio: ' + error.message);
  }
}
async function transmuxToMP4(tsData) {
  try {
    await loadMuxJS();
    
    if (!self.muxjs) {
      throw new Error('mux.js library not available');
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transmuxer = new self.muxjs.mp4.Transmuxer();
        
        const mp4Segments = [];
        
        transmuxer.on('data', (segment) => {
          if (segment.initSegment) {
            mp4Segments.push(segment.initSegment);
          }
          if (segment.data) {
            mp4Segments.push(segment.data);
          }
        });
        
        transmuxer.on('done', () => {
          if (mp4Segments.length === 0) {
            reject(new Error('No MP4 segments generated'));
            return;
          }
          
          const totalLength = mp4Segments.reduce((acc, seg) => acc + seg.byteLength, 0);
          const result = new Uint8Array(totalLength);
          let offset = 0;
          
          for (const segment of mp4Segments) {
            result.set(new Uint8Array(segment), offset);
            offset += segment.byteLength;
          }
          
          resolve(result);
        });
        
        transmuxer.push(tsData);
        transmuxer.flush();
        
        setTimeout(() => {
          if (mp4Segments.length === 0) {
            reject(new Error('MP4 conversion timeout'));
          }
        }, 5000);
        
      } catch (error) {
        reject(error);
      }
    });
    
  } catch (error) {
    throw new Error('MP4 conversion failed: ' + error.message);
  }
}

async function loadMuxJS() {
  if (self.muxjs) {
    return true;
  }
  
  try {
    importScripts('mux.min.js');
    return true;
  } catch (error) {
    console.warn('mux.js not available, keeping TS format:', error);
    return false;
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cancelDownload(downloadId) {
  const downloadInfo = activeDownloads.get(downloadId);
  if (downloadInfo) {
    downloadInfo.cancelled = true;
    downloadInfo.status = 'cancelled';
    activeDownloads.set(downloadId, downloadInfo);
    broadcastProgress(downloadId);
  }
}

function broadcastProgress(downloadId) {
  chrome.runtime.sendMessage({
    action: 'downloadProgress',
    downloadId: downloadId,
    data: activeDownloads.get(downloadId)
  }).catch(() => {});
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return await response.text();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return await response.arrayBuffer();
}

function parseMasterPlaylist(playlistText, baseUrl) {
  const lines = playlistText.split('\n');
  const variants = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attributes = parseAttributes(line);
      const nextLine = lines[i + 1]?.trim();
      
      if (nextLine && !nextLine.startsWith('#')) {
        const resolution = attributes.RESOLUTION || 'Unknown';
        const bandwidth = parseInt(attributes.BANDWIDTH) || 0;
        
        let quality = 'Auto';
        if (resolution !== 'Unknown') {
          const height = resolution.split('x')[1];
          quality = height + 'p';
        }
        
        variants.push({
          quality: quality,
          resolution: resolution,
          bandwidth: bandwidth,
          url: resolveUrl(baseUrl, nextLine)
        });
      }
    }
  }
  
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  
  return variants;
}

function parseSegmentPlaylist(playlistText, baseUrl) {
  const lines = playlistText.split('\n').filter(line => line.trim());
  const segments = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#') && line.length > 0) {
      const segmentUrl = resolveUrl(baseUrl, line);
      segments.push({ url: segmentUrl });
    }
  }
  
  return segments;
}

function parseAttributes(line) {
  const attributes = {};
  const attributeRegex = /([A-Z-]+)=("([^"]*)"|([^,]*))/g;
  let match;
  
  while ((match = attributeRegex.exec(line)) !== null) {
    const key = match[1];
    const value = match[3] || match[4];
    attributes[key] = value;
  }
  
  return attributes;
}

function resolveUrl(baseUrl, relativePath) {
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  
  const base = new URL(baseUrl);
  if (relativePath.startsWith('/')) {
    return `${base.protocol}//${base.host}${relativePath}`;
  } else {
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return `${base.protocol}//${base.host}${basePath}${relativePath}`;
  }
}

function generateId() {
  return 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

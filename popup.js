let currentTabId = null;
let selectedStream = null;

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  
  loadStreams();
  loadActiveDownloads();
  
  document.getElementById('view-all-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('downloader.html') });
  });
});

async function loadStreams() {
  const loading = document.getElementById('loading');
  const noStreams = document.getElementById('no-streams');
  const streamsContainer = document.getElementById('streams-container');
  const streamsList = document.getElementById('streams-list');
  const streamCount = document.getElementById('stream-count');
  
  loading.style.display = 'block';
  noStreams.style.display = 'none';
  streamsContainer.style.display = 'none';
  
  chrome.runtime.sendMessage(
    { action: 'getStreams', tabId: currentTabId },
    (response) => {
      loading.style.display = 'none';
      
      if (!response || !response.streams || response.streams.length === 0) {
        noStreams.style.display = 'block';
        return;
      }
      
      streamsContainer.style.display = 'block';
      streamCount.textContent = response.streams.length;
      
      streamsList.innerHTML = '';
      response.streams.forEach((stream, index) => {
        const streamItem = createStreamItem(stream, index);
        streamsList.appendChild(streamItem);
      });
    }
  );
}

function createStreamItem(stream, index) {
  const item = document.createElement('div');
  item.className = 'stream-item';
  item.dataset.streamIndex = index;
  
  const title = stream.url.split('/').pop().split('?')[0] || 'Video Stream';
  
  item.innerHTML = `
    <div class="stream-info">
      <div class="stream-title">${title}</div>
      <div class="stream-url-short">${stream.url.substring(0, 50)}...</div>
    </div>
    <div class="stream-actions-main">
      <button class="action-btn video-btn">
        <span class="icon">🎬</span> Video Download
      </button>
      <button class="action-btn audio-btn">
        <span class="icon">🎵</span> Audio Only
      </button>
    </div>
    <div class="quality-selector">
      <div class="quality-label">Select Quality:</div>
      <div class="quality-options">Loading...</div>
    </div>
  `;
  
  const videoBtn = item.querySelector('.video-btn');
  const audioBtn = item.querySelector('.audio-btn');
  const selector = item.querySelector('.quality-selector');
  const options = item.querySelector('.quality-options');
  
  videoBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isActive = selector.classList.contains('active');
    
    // Close all other selectors
    document.querySelectorAll('.quality-selector').forEach(s => s.classList.remove('active'));
    
    if (!isActive) {
      selector.classList.add('active');
      if (!selector.dataset.loaded) {
        await loadQualityOptions(stream.url, selector);
        selector.dataset.loaded = 'true';
      }
    }
  });
  
  audioBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startDownload(stream.url, 'Audio', stream.url, true);
  });
  
  return item;
}

async function loadQualityOptions(streamUrl, qualitySelector) {
  const optionsContainer = qualitySelector.querySelector('.quality-options');
  
  chrome.runtime.sendMessage(
    { action: 'getQualityVariants', streamUrl: streamUrl },
    (response) => {
      optionsContainer.innerHTML = '';
      
      const variants = response?.variants || [{ quality: 'Auto', url: streamUrl, resolution: 'Original' }];
      
      variants.forEach(variant => {
        const btn = document.createElement('button');
        btn.className = 'quality-opt-btn';
        btn.innerHTML = `
          <span class="q-name">${variant.quality}</span>
          <span class="q-res">${variant.resolution !== 'Unknown' ? variant.resolution : ''}</span>
        `;
        
        btn.addEventListener('click', () => {
          startDownload(streamUrl, variant.quality, variant.url);
        });
        
        optionsContainer.appendChild(btn);
      });
    }
  );
}

function startDownload(streamUrl, quality, qualityUrl, audioOnly = false) {
  chrome.runtime.sendMessage({
    action: 'startDownload',
    streamUrl: streamUrl,
    quality: quality,
    qualityUrl: qualityUrl,
    tabId: currentTabId,
    audioOnly: audioOnly
  }, (response) => {
    if (response?.success) {
      window.close();
    }
  });
}

async function loadActiveDownloads() {
  chrome.runtime.sendMessage(
    { action: 'getActiveDownloads' },
    (response) => {
      if (!response || !response.downloads || response.downloads.length === 0) {
        document.getElementById('active-downloads').style.display = 'none';
        return;
      }
      
      document.getElementById('active-downloads').style.display = 'block';
      const preview = document.getElementById('downloads-preview');
      preview.innerHTML = '';
      
      response.downloads.slice(0, 2).forEach(download => {
        const card = createDownloadPreview(download);
        preview.appendChild(card);
      });
    }
  );
}

function createDownloadPreview(download) {
  const card = document.createElement('div');
  card.className = 'download-preview';
  
  card.innerHTML = `
    <div class="download-preview-header">
      <span class="download-quality">${download.quality}</span>
      <span class="download-status">${download.status}</span>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" style="width: ${download.progress}%"></div>
    </div>
    <div class="download-stats">
      <span>${download.segmentsDownloaded} / ${download.totalSegments} segments</span>
      <span>${Math.round(download.progress)}%</span>
    </div>
  `;
  
  return card;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadProgress') {
    loadActiveDownloads();
  }
});

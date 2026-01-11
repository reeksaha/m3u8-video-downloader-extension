let currentDownloadId = null;

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentDownloadId = urlParams.get('id');
  
  loadDownloads();
  
  setInterval(loadDownloads, 1000);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadProgress') {
    loadDownloads();
  }
});

async function loadDownloads() {
  chrome.runtime.sendMessage(
    { action: 'getActiveDownloads' },
    (response) => {
      if (!response || !response.downloads) return;
      
      const container = document.getElementById('downloads-container');
      const noDownloads = document.getElementById('no-downloads');
      
      if (response.downloads.length === 0) {
        noDownloads.style.display = 'block';
        container.innerHTML = '';
        return;
      }
      
      noDownloads.style.display = 'none';
      
      container.innerHTML = '';
      response.downloads.forEach(download => {
        const card = createDownloadCard(download);
        container.appendChild(card);
      });
    }
  );
}

function createDownloadCard(download) {
  const card = document.createElement('div');
  card.className = `download-card ${download.status}`;
  card.dataset.downloadId = download.id;
  
  const statusClass = getStatusClass(download.status);
  const statusText = getStatusText(download.status);
  
  card.innerHTML = `
    <div class="download-header">
      <div class="download-info">
        <div class="download-title">
          <span>Video Download</span>
          <span class="quality-badge">${download.quality}</span>
        </div>
        <div class="download-url">${download.streamUrl}</div>
      </div>
      <div class="status-badge ${statusClass}">${statusText}</div>
    </div>
    
    <div class="progress-section">
      <div class="progress-bar-outer">
        <div class="progress-bar-inner" style="width: ${download.progress}%"></div>
      </div>
      <div class="progress-percentage">${Math.round(download.progress)}%</div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-label">Segments</div>
        <div class="stat-value highlight">${download.segmentsDownloaded} / ${download.totalSegments}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Downloaded</div>
        <div class="stat-value">${formatBytes(download.downloadedBytes)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Speed</div>
        <div class="stat-value highlight">${formatSpeed(download.speed)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Time Remaining</div>
        <div class="stat-value">${formatTime(download.timeRemaining)}</div>
      </div>
    </div>
    
    ${download.error ? `<div class="error-message">${download.error}</div>` : ''}
    
    <div class="actions">
      ${download.status === 'downloading' || download.status === 'initializing' ? 
        `<button class="btn btn-cancel" data-download-id="${download.id}">Cancel Download</button>` : 
        `<button class="btn btn-remove" data-download-id="${download.id}">Remove</button>`
      }
    </div>
  `;
  
  const cancelBtn = card.querySelector('.btn-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelDownload(download.id);
    });
  }
  
  const removeBtn = card.querySelector('.btn-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      removeDownload(download.id);
    });
  }
  
  return card;
}

function getStatusClass(status) {
  return status;
}

function getStatusText(status) {
  const statusMap = {
    'initializing': 'Initializing',
    'downloading': 'Downloading',
    'merging': 'Merging',
    'converting': 'Converting to MP4',
    'completed': 'Completed',
    'error': 'Error',
    'cancelled': 'Cancelled'
  };
  return statusMap[status] || status;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s';
  return formatBytes(bytesPerSecond) + '/s';
}

function formatTime(seconds) {
  if (!seconds || seconds === 0 || !isFinite(seconds)) return '--';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function cancelDownload(downloadId) {
  chrome.runtime.sendMessage({
    action: 'cancelDownload',
    downloadId: downloadId
  });
}

function removeDownload(downloadId) {
  const card = document.querySelector(`[data-download-id="${downloadId}"]`);
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateX(100%)';
    setTimeout(() => {
      chrome.runtime.sendMessage({
        action: 'removeDownload',
        downloadId: downloadId
      }, (response) => {
        card.remove();
        loadDownloads();
      });
    }, 300);
  }
}

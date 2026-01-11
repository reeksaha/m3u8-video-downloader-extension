# 🎬 Advanced m3u8 Video Downloader Chrome Extension

An advanced Chrome extension that automatically detects m3u8 (HLS) streaming content on webpages, allowing users to download streams with multiple quality options and save them as playable video files.

---

## ✨ Features

### Core Functionality
- **Automatic m3u8 Stream Detection**: Monitors network requests and activates when HLS streams are detected
- **Quality Selection**: Parses master playlists and displays available resolutions (1080p, 720p, 480p, etc.)
- **Background Downloading**: Downloads continue in the background using Chrome service workers
- **Segment Merging**: Automatically merges downloaded `.ts` segments into a single video file
- **MP4 Conversion**: Converts HLS streams into standard MP4 files
- **File Saving**: Uses Chrome’s native download dialog

### Advanced Features
- **Concurrent Downloads**
- **Real-time Progress Tracking**
- **Cancel Active Downloads**
- **Modern Liquid Glass UI**

### Progress Indicators
Each active download shows:
- Progress bar with percentage
- Segment count
- Estimated file size
- Download speed
- Time remaining

---

## 🚀 Installation (Local)

### Load as Unpacked Extension

1. Open Chrome and go to:

2. Enable **Developer mode** (top-right)

3. Click **Load unpacked**

4. Select the folder containing `manifest.json`

5. The extension icon will appear in the toolbar (pin it if needed)

---

## 📖 How to Use

1. Visit any webpage with HLS / m3u8 video content
2. When a stream is detected, the extension icon activates
3. Click the icon to view detected streams
4. Select your desired quality
5. Click **Download Video**
6. Monitor progress in the download manager
7. Save the completed video file

---

## 🎨 UI Design

The extension uses a **Liquid Glass** design style featuring:
- Frosted-glass backgrounds
- Smooth animations
- Gradient accents
- Responsive hover and progress effects

---

## 🛠️ Technical Overview

- **Chrome Extension Manifest**: Version 3
- **Background**: Service worker for stream detection and download management
- **Popup UI**: Stream and quality selection
- **Download Manager**: Full-page interface for active downloads
- **Conversion Engine**: Client-side HLS to MP4 transmuxing using mux.js

---

## 🔐 Privacy & Security

- No user data collection
- No external servers
- All processing happens locally in the browser
- Uses Chrome’s official APIs only

---

## 📝 Limitations

- Some streams may be blocked by CORS or DRM
- Very large videos may consume significant memory
- Encrypted streams are not supported

---

## 📄 License

MIT License — free to use and modify.

---

## ⚠️ Disclaimer

This extension is for educational and personal use only. Always respect copyright laws and website terms of service. Only download content you have permission to download.

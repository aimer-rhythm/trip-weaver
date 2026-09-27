import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'leaflet/dist/leaflet.css';
// 中文正文用开源近似苹方的字体（苹方本身是 macOS 自带字体，Windows 上没有）：
// fontsource 按 unicode-range 切了 101 个子集，浏览器只拉页面用到的字形。
import '@fontsource-variable/noto-sans-sc';
// 标题与里程碑标题用思源宋体：设计稿的标题是衷线体（见 09-27 视觉对齐任务）
import '@fontsource-variable/noto-serif-sc';
import './styles/tailwind.css';
import './styles/global.css';
import './styles/print.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'leaflet/dist/leaflet.css';
// 中文正文用开源近似苹方的字体（苹方本身是 macOS 自带字体，Windows 上没有）：
// fontsource 按 unicode-range 切了 101 个子集，浏览器只拉页面用到的字形。
import '@fontsource-variable/noto-sans-sc';
// 宋体正文回退；本地手写体和京华老宋的 font-face 统一由 Tailwind 入口加载。
import '@fontsource-variable/noto-serif-sc';
import './styles/tailwind.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

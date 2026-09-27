import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import 'leaflet/dist/leaflet.css';
// 中文正文用开源近似苹方的字体（苹方本身是 macOS 自带字体，Windows 上没有）：
// fontsource 按 unicode-range 切了 101 个子集，浏览器只拉页面用到的字形。
import '@fontsource-variable/noto-sans-sc';
// 设计稿标题是「京華老宋体」（老宋体，三角字肩/鹅头勾）：分片 woff2 见 public/fonts/kinghwa
import './styles/kinghwa-font.css';
// 拍立得卡片说明文字：设计稿是手写体，候选比对后选千图笔锋手写体（见 fonts-compare.png）
import './styles/handwriting-font.css';
// 衷线兵底：思源宋体（京华老宋体片未覆盖到的字——如生僻地名——落到这里）
import '@fontsource-variable/noto-serif-sc';
import './styles/tailwind.css';
import './styles/global.css';
import './styles/print.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

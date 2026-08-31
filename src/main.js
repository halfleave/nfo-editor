/* PC 入口：等待 DOM 就绪后启动，函数均来自 core.js / ui.js 全局作用域 */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootApp);
else bootApp();

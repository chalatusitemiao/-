import { createApp } from 'vue'
import App from './App.vue'
import { installWheelGuard } from './utils/wheelGuard.js'
import './styles/tokens.css'
import './styles/app.css'

// 防止鼠标滚轮在数字输入框上误改数值（详见 utils/wheelGuard.js）
installWheelGuard(document)

createApp(App).mount('#app')

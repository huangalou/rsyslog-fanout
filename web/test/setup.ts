// 單元測試一律固定 zh-TW,現有中文文字斷言不受瀏覽器語言影響。
import { config } from '@vue/test-utils'
import { i18n } from '../src/i18n'

i18n.global.locale.value = 'zh-TW'
config.global.plugins.push(i18n)

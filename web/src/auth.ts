// 登入狀態的樂觀旗標：session cookie 為 httpOnly 前端讀不到，
// 以 localStorage 旗標供 router guard 判斷是否值得進入需授權頁。
// 真正的授權仍由 server cookie 決定——旗標過期時 API 回 401，
// client 的 unauthorized handler 會清旗標並導回 /login。
const KEY = 'fanout_logged_in'

export const isLoggedIn = (): boolean => localStorage.getItem(KEY) === '1'
export const markLoggedIn = (): void => localStorage.setItem(KEY, '1')
export const clearLoggedIn = (): void => localStorage.removeItem(KEY)

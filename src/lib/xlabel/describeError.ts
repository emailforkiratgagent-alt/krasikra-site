import { XLabelError } from './errors'

/**
 * Explains an X.Label failure to the site administrator (admin panel, Russian).
 * Not for customers: customer-facing texts come from X.Label itself (`error` field).
 */
export function describeErrorForAdmin(error: unknown, baseUrl?: string): string {
  if (!(error instanceof XLabelError)) {
    return 'Непредвиденная ошибка на сервере сайта. Подробности — в журнале контейнера.'
  }
  const where = baseUrl ? ` (${baseUrl})` : ''
  switch (error.kind) {
    case 'config':
      if (/different SETTINGS_ENCRYPTION_KEY/.test(error.message)) {
        return 'Ключ шифрования на сервере изменился, сохранённый токен не расшифровать. Введите токен сайта заново и сохраните.'
      }
      if (/SETTINGS_ENCRYPTION_KEY/.test(error.message)) {
        return 'На сервере не задан или неверен ключ шифрования SETTINGS_ENCRYPTION_KEY. Обратитесь к разработчику.'
      }
      if (/corrupted|tampered|format/.test(error.message)) {
        return 'Сохранённый токен повреждён. Введите токен сайта заново и сохраните.'
      }
      return 'Заполните адрес сервера X.Label и токен сайта и нажмите «Сохранить».'
    case 'network':
      return `Не удалось связаться с сервером X.Label${where}. Проверьте адрес.`
    case 'timeout':
      return `Сервер X.Label${where} не ответил вовремя. Попробуйте ещё раз через минуту.`
    case 'api':
      if (error.status === 401) {
        return `X.Label не принял токен сайта: «${error.message}». Проверьте токен (поле webAppToken проекта в админке X.Label).`
      }
      return `X.Label ответил ошибкой: «${error.message}».`
    case 'http':
      if (error.status === 401 || error.status === 403) {
        return `X.Label не принял токен сайта (код ${error.status}). Проверьте токен.`
      }
      if (error.status === 404) {
        return `По этому адресу${where} нет API X.Label (код 404). Проверьте адрес сервера.`
      }
      return `Сервер X.Label ответил кодом ${error.status}. Если повторяется — сообщите X.Label.`
    case 'parse':
      return `Ответ сервера${where} не похож на API X.Label. Проверьте адрес сервера.`
  }
}

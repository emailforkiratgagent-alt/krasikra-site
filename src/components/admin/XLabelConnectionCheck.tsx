'use client'

import { Button, useConfig, useFormModified } from '@payloadcms/ui'
import { useState } from 'react'

type Item = { name: string; ok: boolean; message: string }
type Result = { ok: boolean; items: Item[] }

/** «Проверить подключение» button for the X.Label integration global. */
export function XLabelConnectionCheck() {
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const modified = useFormModified()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setResult(null)
    setFailure(null)
    try {
      const res = await fetch(`${serverURL}${api}/globals/xlabel-integration/check-connection`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        setFailure(
          res.status === 403
            ? 'Проверка доступна только администратору.'
            : `Ошибка сервера сайта (${res.status}).`,
        )
        return
      }
      setResult((await res.json()) as Result)
    } catch {
      setFailure('Не удалось выполнить проверку: нет связи с сервером сайта.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="field-type xlabel-check" style={{ marginBottom: 'var(--base)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--base) / 2)', flexWrap: 'wrap' }}>
        <Button buttonStyle="secondary" disabled={loading} margin={false} onClick={run} size="medium">
          {loading ? 'Проверяем…' : 'Проверить подключение'}
        </Button>
        <span style={{ color: 'var(--theme-elevation-500)' }}>
          {modified
            ? 'Есть несохранённые изменения — проверка идёт по сохранённым настройкам. Сначала нажмите «Сохранить».'
            : 'Проверяет сохранённые настройки. В X.Label ничего не записывается.'}
        </span>
      </div>

      {failure && (
        <p role="alert" style={{ color: 'var(--theme-error-500)', marginTop: 'calc(var(--base) / 2)' }}>
          {failure}
        </p>
      )}

      {result && (
        <div
          role="status"
          style={{
            marginTop: 'calc(var(--base) / 2)',
            padding: 'calc(var(--base) / 2) var(--base)',
            border: `1px solid ${result.ok ? 'var(--theme-success-500)' : 'var(--theme-error-500)'}`,
            borderRadius: 'var(--style-radius-s)',
          }}
        >
          <strong>{result.ok ? 'Подключение работает' : 'Есть проблемы'}</strong>
          <ul style={{ margin: 'calc(var(--base) / 4) 0 0', paddingLeft: '1.2em' }}>
            {result.items.map((item) => (
              <li key={item.name}>
                {item.ok ? '✓' : '✗'} <b>{item.name}:</b> {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import './styles.css'

export const metadata: Metadata = {
  title: {
    default: 'Хозяин Камчатки — икра и рыбные деликатесы',
    template: '%s — Хозяин Камчатки',
  },
  description:
    'Сеть специализированных магазинов икры и рыбных деликатесов «Хозяин Камчатки». Красноярск, 10 магазинов.',
  icons: { icon: '/brand/logo-sign.svg' },
}

export const viewport: Viewport = {
  themeColor: '#14324C',
}

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}

import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'CSH Dashboard',
  description: 'CSH call analytics dashboard',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}

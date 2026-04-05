// ─────────────────────────────────────────────────────────────────────
// Wugi Lens — useRouterSync
// Polls GL.iNet Slate AX router for new photos from camera WiFi sync
// Sony Creators' App and Canon Camera Connect write to router's SMB share
// Router IP when phone connects to router WiFi: 192.168.8.1
// ─────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react'
import type { RouterStatus } from '../types'

const DEFAULT_ROUTER_IP   = '192.168.8.1'
const POLL_INTERVAL_MS    = 3000
const ROUTER_API_PATH     = '/cgi-bin/luci/rpc/sys'
const PHOTO_EXTENSIONS    = ['.jpg', '.jpeg', '.JPG', '.JPEG', '.png', '.PNG']

export type RouterFile = {
  name:     string
  path:     string
  size:     number
  modified: number
}

type UseRouterSyncOptions = {
  routerIp?:   string
  watchPath?:  string
  onNewFiles:  (files: RouterFile[]) => void
  enabled:     boolean
}

export function useRouterSync({
  routerIp  = DEFAULT_ROUTER_IP,
  watchPath = '/mnt/sda1/DCIM',
  onNewFiles,
  enabled,
}: UseRouterSyncOptions) {
  const [status,    setStatus]    = useState<RouterStatus>('disconnected')
  const [fileCount, setFileCount] = useState(0)
  const seenFiles   = useRef<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const ping = useCallback(async (): Promise<boolean> => {
    try {
      const controller = new AbortController()
      const timeout    = setTimeout(() => controller.abort(), 2000)
      const res        = await fetch(`http://${routerIp}`, { signal: controller.signal })
      clearTimeout(timeout)
      return res.ok || res.status < 500
    } catch { return false }
  }, [routerIp])

  const scanFiles = useCallback(async () => {
    try {
      // GL.iNet routers expose a file listing via HTTP
      // The router serves files at http://192.168.8.1/webdav/ or similar
      // We use a simple directory listing approach
      const url = `http://${routerIp}/cgi-bin/luci/rpc/fs?path=${encodeURIComponent(watchPath)}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })

      if (!res.ok) {
        // Fallback: try static file listing
        const listUrl = `http://${routerIp}/files`
        const listRes = await fetch(listUrl)
        if (!listRes.ok) return

        const text = await listRes.text()
        // Parse basic directory listing HTML for image files
        const matches = [...text.matchAll(/href="([^"]+\.(?:jpg|jpeg|JPG|JPEG))"/g)]
        const newFiles: RouterFile[] = []

        for (const match of matches) {
          const name = match[1]
          if (!seenFiles.current.has(name)) {
            seenFiles.current.add(name)
            newFiles.push({
              name,
              path: `http://${routerIp}/files/${name}`,
              size: 0,
              modified: Date.now(),
            })
          }
        }

        if (newFiles.length > 0) {
          setFileCount(prev => prev + newFiles.length)
          onNewFiles(newFiles)
        }
        return
      }

      const data: { files?: RouterFile[] } = await res.json()
      const files = (data.files || []).filter(f =>
        PHOTO_EXTENSIONS.some(ext => f.name.endsWith(ext))
      )
      const newFiles = files.filter(f => !seenFiles.current.has(f.name))

      for (const f of newFiles) seenFiles.current.add(f.name)

      if (newFiles.length > 0) {
        setFileCount(prev => prev + newFiles.length)
        onNewFiles(newFiles)
      }
    } catch (e) {
      console.log('[RouterSync] scan error:', e)
    }
  }, [routerIp, watchPath, onNewFiles])

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected')
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    setStatus('connecting')

    ping().then(reachable => {
      if (!reachable) { setStatus('disconnected'); return }
      setStatus('connected')
      scanFiles()
      intervalRef.current = setInterval(scanFiles, POLL_INTERVAL_MS)
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [enabled, ping, scanFiles])

  return { status, fileCount }
}

'use client'

// App-wide confirm/alert dialog, so no code path ever reaches for
// `window.confirm` — a native modal blocks the whole tab, and on the kiosk it
// blocks the capture loop with no way to dismiss it without a keyboard.
//
// Built on Headless UI's Dialog with PickLT's panel styling (rounded-2xl,
// backdrop blur, transition on data-closed).

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/shared/Button'

type Tone = 'danger' | 'primary'

type ConfirmOptions = {
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  tone?: Tone
}

type DialogCtx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  alert: (opts: Omit<ConfirmOptions, 'cancelText' | 'tone'>) => Promise<void>
}

const Ctx = createContext<DialogCtx | null>(null)

type State = (ConfirmOptions & { kind: 'confirm' | 'alert' }) | null

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null)
  // The promise resolver for the dialog currently on screen. Held in a ref so
  // re-renders never lose it.
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setState(null)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setState({ ...opts, kind: 'confirm' })
    })
  }, [])

  const alert = useCallback(
    (opts: Omit<ConfirmOptions, 'cancelText' | 'tone'>) => {
      return new Promise<void>((resolve) => {
        resolverRef.current = () => resolve()
        setState({ ...opts, kind: 'alert' })
      })
    },
    [],
  )

  const open = state !== null
  const tone: Tone = state?.tone ?? 'primary'

  return (
    <Ctx.Provider value={{ confirm, alert }}>
      {children}
      <Dialog open={open} onClose={() => settle(false)} className="relative z-50">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-neutral-950/60 backdrop-blur-sm duration-200 ease-out data-closed:opacity-0"
        />
        <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
          <DialogPanel
            transition
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl duration-200 ease-out data-closed:scale-95 data-closed:opacity-0 dark:bg-neutral-800"
          >
            <DialogTitle className="text-lg font-semibold text-neutral-950 dark:text-white">
              {state?.title}
            </DialogTitle>
            {state?.message && (
              <div className="mt-2 text-sm/6 text-neutral-500 dark:text-neutral-400">
                {state.message}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              {state?.kind === 'confirm' && (
                <Button plain onClick={() => settle(false)}>
                  {state?.cancelText ?? 'Cancel'}
                </Button>
              )}
              <Button color={tone === 'danger' ? 'red' : 'primary'} onClick={() => settle(true)}>
                {state?.confirmText ?? (state?.kind === 'alert' ? 'OK' : 'Confirm')}
              </Button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </Ctx.Provider>
  )
}

export function useDialog() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDialog must be used inside DialogProvider')
  return v
}

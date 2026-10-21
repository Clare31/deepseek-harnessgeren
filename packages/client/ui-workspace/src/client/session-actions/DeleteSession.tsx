/**
 * The permanent-deletion action: a `sidebar.workspaces.session.menu.item` row
 * that asks for confirmation, plus the `shell.overlay` dialog that carries the
 * irreversible Host call.
 *
 * Deleting is not archiving. The confirmation is mandatory because the stored
 * log and every message in it are removed; there is no notice with an undo.
 * The menu row is separated from the reversible actions above it and uses the
 * destructive color so the consequence is visible before the click.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconTrashOutlineRegular, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteConfirmInjected, SessionDeleteConfirmProps, SessionDeleteConfirmRequest,
  SessionMenuItemProps,
} from '../contract/slots.ts'
import browserCss from '../rows/WorkspaceBrowser.module.css'

/**
 * Menu row (order 500): ask for the permanent-deletion confirmation.
 * @param props - owner share, the delete share, the menu open state, and the locale seat.
 * @returns the row.
 */
export function DeleteSessionMenuItem({
  sessionId, useMenuOpenState, requestDeleteSession, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      danger
      separatorBefore
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestDeleteSession(sessionId)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session).
 * @param props - the request hook, its settlement, the delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <SessionDeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function SessionDeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  deleteSession: SessionDeleteConfirmInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteConfirmProps['t']
}): ReactNode {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    if (deleting) return
    onSettle()
  }
  const confirm = (): void => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(deleteFailureText(reason, t))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.confirm.title')}
      description={t('delete.confirm.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t(deleting ? 'delete.confirm.pending' : 'delete.confirm.action')}
          </Button>
        </>
      )}
    >
      <p className={browserCss.deleteStatus} role="note">{t('delete.confirm.warning')}</p>
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}

/**
 * Translate the Host failures a permanent deletion can raise into copy the
 * dialog can act on, leaving any other diagnostic as the Host wrote it.
 * Error-class identity is checked by name because client plugin bundles do not
 * share class instances.
 * @param reason - rejection from the delete hop.
 * @param t - the section's copy seat.
 * @returns the message to show in the dialog.
 */
function deleteFailureText(reason: unknown, t: SessionDeleteConfirmProps['t']): string {
  if (reason instanceof Error && reason.name === 'SessionDeleteError') {
    const failure = reason as Error & { rpcError?: { code?: unknown } }
    const code = failure.rpcError?.code
    if (code === 'session/live') return t('delete.confirm.live')
    if (code === 'session/not-found') return t('delete.confirm.missing')
  }
  return reason instanceof Error ? reason.message : String(reason)
}

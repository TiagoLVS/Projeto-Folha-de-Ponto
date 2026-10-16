'use client';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
export function ConfirmationDialog({ open, title, description, busy = false, disabled = false, confirmLabel = 'Confirmar', onConfirm, onCancel }: {
  open: boolean; title: string; description: string; busy?: boolean; disabled?: boolean; confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  return <AlertDialog open={open} onOpenChange={value => { if (!value && !busy) onCancel(); }}>
    <AlertDialogContent className="send-dialog">
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={busy} onClick={onCancel}>Cancelar</AlertDialogCancel>
        <AlertDialogAction disabled={busy || disabled} onClick={event => { event.preventDefault(); onConfirm(); }}>{busy ? 'Aguarde…' : confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

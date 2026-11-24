import type { EmailLog } from './email-api.ts';

export type EmailHistoryState = {
  logs: EmailLog[];
  selectedIds: number[];
};

export type EmailHistoryAction =
  | { type: 'history-loaded'; logs: EmailLog[] }
  | { type: 'filters-changed' }
  | { type: 'toggle'; id: number; checked: boolean }
  | { type: 'toggle-all-errors'; checked: boolean }
  | { type: 'clear-selection' };

export const initialEmailHistoryState: EmailHistoryState = {
  logs: [],
  selectedIds: [],
};

export function emailHistoryReducer(state: EmailHistoryState, action: EmailHistoryAction): EmailHistoryState {
  switch (action.type) {
    case 'history-loaded':
      return { logs: action.logs, selectedIds: [] };
    case 'filters-changed':
    case 'clear-selection':
      return { ...state, selectedIds: [] };
    case 'toggle': {
      const log = state.logs.find(item => item.id === action.id);
      if (!log || log.status !== 'ERRO') return state;
      const selectedIds = state.selectedIds.filter(id => id !== action.id);
      if (action.checked) selectedIds.push(action.id);
      return { ...state, selectedIds };
    }
    case 'toggle-all-errors':
      return {
        ...state,
        selectedIds: action.checked ? state.logs.filter(log => log.status === 'ERRO').map(log => log.id) : [],
      };
  }
}

export function canRetryEmailErrors(count: number, blocked: boolean, busy: boolean, loading: boolean): boolean {
  return count > 0 && !blocked && !busy && !loading;
}

export function retryConfirmationText(count: number): string {
  const quantity = `${count} ${count === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'}`;
  return `Serão reenviadas exatamente ${quantity}. O servidor revalidará a aptidão e ignorará folhas removidas ou já enviadas.`;
}

export function retryIdempotencyKey(keys: Map<string, string>, ids: number[], create: () => string): string {
  const signature = JSON.stringify([...ids].sort((a, b) => a - b));
  let key = keys.get(signature);
  if (!key) {
    key = create();
    keys.set(signature, key);
  }
  return key;
}

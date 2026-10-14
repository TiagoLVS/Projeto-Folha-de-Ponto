'use client';
import { useEffect, useState } from 'react';
import { eventTypes, listEvents, type AcademicEvent } from '@/lib/academic-api';

export function PeriodEvents({ month }: { month: string }) {
  const [state, setState] = useState<{ month: string; events?: AcademicEvent[]; error?: string }>({ month: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    listEvents({ ano: Number(month.slice(0, 4)), mes: Number(month.slice(5)) }, controller.signal)
      .then(events => setState({ month, events }))
      .catch(error => { if (!controller.signal.aborted) setState({ month, error: error.message }); });
    return () => controller.abort();
  }, [month, attempt]);
  return <section className="academic-panel period-events" aria-label="Datas especiais da competência"><h2>Datas especiais da competência</h2>
    <p>Referência do calendário atual. Documentos já armazenados mantêm seu conteúdo original.</p>
    {state.month !== month ? <p role="status">Carregando calendário…</p> : state.error ? <p role="alert">{state.error} <button onClick={() => setAttempt(v => v + 1)}>Tentar novamente</button></p> : state.events?.length ? <ul>{state.events.map(event => <li key={event.id_data_especial}><time dateTime={event.data}>{event.data.split('-').reverse().join('/')}</time> · <span className={`event-tag type-${event.tipo}`}>{eventTypes[event.tipo]}</span> {event.especificacao}</li>)}</ul> : <p>Nenhuma data especial cadastrada neste mês.</p>}
  </section>;
}

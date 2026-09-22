"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, Download, FileText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { monthLabel, sheetStatus, type Professor, type Sheet } from '@/lib/ponto';
import { processDocument } from '@/lib/timesheet-api';
import { toast } from 'sonner';

type Props = {
  professor: Professor;
  professors: Professor[];
  month: string;
  onMonth: (month: string) => void;
  onBack: () => void;
  onChange: Dispatch<SetStateAction<Professor[]>>;
  onLinked: (id: string, month: string) => void;
};

export function DocumentSheet({
  professor,
  professors,
  month,
  onMonth,
  onBack,
  onChange,
  onLinked
}: Props) {
  const sheet = professor.sheets[month];

  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [manual, setManual] = useState(false);
  const [target, setTarget] = useState('');
  const [period, setPeriod] = useState(month);

  const [conflict, setConflict] = useState<{ id: string; month: string }>();

  const [preview, setPreview] = useState(true);
  const [drag, setDrag] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  function update(value?: Sheet) {
    onChange(ps =>
      ps.map(p => {
        if (p.id !== professor.id) return p;

        const sheets = { ...p.sheets };

        if (value) sheets[month] = value;
        else delete sheets[month];

        return { ...p, sheets };
      })
    );
  }

  function choose(f?: File) {
    setError('');

    if (!f) return;

    if (
      !['application/pdf', 'image/jpeg', 'image/png'].includes(f.type) ||
      !/\.(pdf|jpe?g|png)$/i.test(f.name)
    ) {
      setError('Arquivo inválido. Selecione PDF, JPG ou PNG.');
      return;
    }

    if (!f.size || f.size > 15 * 1024 * 1024) {
      setError('O arquivo deve ter conteúdo e no máximo 15 MB.');
      return;
    }

    setFile(f);
  }

  async function upload() {
    if (!file || lock.current) return;

    if (
      sheet &&
      !window.confirm(
        `Já existe uma folha para ${monthLabel(month)}. Substituir o documento e seu vínculo?`
      )
    ) {
      return;
    }

    lock.current = true;
    setBusy(true);
    setError('');

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));

        reader.readAsDataURL(file);
      });

      update({
        id: crypto.randomUUID(),
        status: 'uploaded',
        updatedAt: new Date().toISOString(),
        attachment: {
          name: file.name,
          size: file.size,
          type: file.type,
          url
        }
      });

      setFile(undefined);
      setManual(false);
      setTarget('');

      toast.success('Folha adicionada neste navegador.');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Falha ao adicionar arquivo.'
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function process() {
    if (!sheet || lock.current) return;

    lock.current = true;
    setBusy(true);
    setError('');
    setManual(false);

    const controller = new AbortController();
    abort.current = controller;

    const timeout = setTimeout(() => controller.abort(), 60000);

    update({
      ...sheet,
      status: 'processing',
      error: undefined,
      confirmedAt: undefined
    });

    try {
      const data = await processDocument(sheet, controller.signal);

      update({
        ...sheet,
        status: 'identified',
        identifiedData: data,
        identificationSource: 'api',
        confirmedAt: undefined,
        error: undefined,
        updatedAt: new Date().toISOString()
      });

      const matches = professors.filter(
        p => p.registration === data.registration
      );

      setTarget(matches.length === 1 ? matches[0].id : '');
      setPeriod(data.competence || month);
    } catch (e) {
      const message = controller.signal.aborted
        ? 'Processamento interrompido ou tempo limite excedido. Tente novamente.'
        : e instanceof Error
          ? e.message
          : 'Erro na leitura.';

      update({
        ...sheet,
        status: 'error',
        confirmedAt: undefined,
        error: message
      });
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      setBusy(false);
    }
  }

  function confirm() {
    if (
      !sheet ||
      !target ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)
    ) {
      setError('Selecione o professor e uma competência válida.');
      return;
    }

    const person = professors.find(p => p.id === target)!;

    if (
      person.sheets[period] &&
      person.sheets[period].id !== sheet.id
    ) {
      setConflict({
        id: target,
        month: period
      });

      setError(
        `Já existe uma folha para ${person.name} em ${monthLabel(period)}. Abra a competência existente para visualizar ou substituir; este documento foi preservado.`
      );

      return;
    }

    const value: Sheet = {
      ...sheet,
      status: 'identified',
      identificationSource: manual
        ? 'manual'
        : sheet.identificationSource,
      confirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: undefined
    };

    onChange(ps =>
      ps.map(p => {
        const sheets = { ...p.sheets };

        if (p.id === professor.id) {
          delete sheets[month];
        }

        if (p.id === target) {
          sheets[period] = value;
        }

        return {
          ...p,
          sheets
        };
      })
    );

    toast.success('Folha vinculada com sucesso.');
    onLinked(target, period);
  }

  const badge =
    sheet?.status === 'error'
      ? 'error'
      : sheet?.status === 'identified'
        ? 'done'
        : sheet
          ? 'progress'
          : 'empty';

  return (
    <div className="view-enter">
      <button
        className="back-button"
        onClick={onBack}
      >
        <ArrowLeft size={16} />
        Voltar ao professor
      </button>

      <div className="page-heading">
        <div>
          <p className="eyebrow">DOCUMENTO DE PONTO</p>
          <h1>{professor.name}</h1>
          <p>Matrícula: {professor.registration}</p>
        </div>

        <label className="month-control">
          Competência
          <input
            aria-label="Competência da folha"
            type="month"
            value={month}
            disabled={busy}
            onChange={e =>
              /^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) &&
              onMonth(e.target.value)
            }
          />
        </label>
      </div>

      <p className="email-note">
        Documentos salvos neste navegador. Mantenha os originais; o arquivo central depende da integração com o servidor.
      </p>

      {error && (
        <p
          role="alert"
          className="form-error"
        >
          {error}
        </p>
      )}

      {conflict && (
        <div className="document-actions">
          <Button
            variant="outline"
            onClick={() =>
              onLinked(conflict.id, conflict.month)
            }
          >
            Visualizar existente / substituir
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setConflict(undefined);
              setError('');
            }}
          >
            Cancelar
          </Button>
        </div>
      )}

      <section className="table-card uploaded-sheet-card">
        <div className="table-toolbar">
          <h2>{monthLabel(month)}</h2>

          <span
            role="status"
            className={`status-badge status-${badge}`}
          >
            <span />
            {sheetStatus(sheet)}
          </span>
        </div>

        <div className="document-body">
          <input
            ref={input}
            className="sheet-file-input"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={busy}
            onChange={e => {
              choose(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />

          {!sheet || file ? (
            <div
              className={`upload-dropzone ${
                drag ? 'drag-active' : ''
              }`}
              onDragOver={e => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => {
                e.preventDefault();
                setDrag(false);

                if (!busy) {
                  if (e.dataTransfer.files.length !== 1) {
                    setError(
                      'Selecione um arquivo por competência.'
                    );
                  } else {
                    choose(e.dataTransfer.files[0]);
                  }
                }
              }}
            >
              <Upload size={28} />

              <strong>Arraste a folha aqui</strong>
              <span>ou</span>

              <Button
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                Selecionar arquivo
              </Button>

              <small>
                PDF, JPG ou PNG · Máximo de 15 MB
              </small>

              {file && (
                <>
                  <strong>{file.name}</strong>

                  <span>
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </span>

                  <div className="row-actions">
                    <Button
                      disabled={busy}
                      onClick={upload}
                    >
                      {busy
                        ? 'Adicionando…'
                        : 'Enviar folha'}
                    </Button>

                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setFile(undefined)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {sheet && (
            <>
              <div className="uploaded-file-meta">
                <FileText />

                <div>
                  <strong>{sheet.attachment.name}</strong>

                  <span>
                    {(sheet.attachment.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              </div>

              <div className="document-actions">
                <Button
                  variant="outline"
                  onClick={() => setPreview(v => !v)}
                >
                  Visualizar folha
                </Button>

                <a
                  className="text-action"
                  href={sheet.attachment.url}
                  download={sheet.attachment.name}
                >
                  <Download size={16} />
                  Baixar original
                </a>

                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  Substituir folha
                </Button>

                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Remover esta folha e seu vínculo?'
                      )
                    ) {
                      update();
                      setManual(false);
                      setError('');
                    }
                  }}
                >
                  Remover folha
                </Button>
              </div>

              {preview && (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      previewRef.current
                        ?.requestFullscreen?.()
                        .catch(() =>
                          setError(
                            'Tela cheia indisponível. Use a visualização ou baixe o original.'
                          )
                        )
                    }
                  >
                    Abrir em tela cheia
                  </Button>

                  <div
                    ref={previewRef}
                    className="sheet-preview"
                  >
                    {sheet.attachment.type === 'application/pdf' ? (
                      <iframe
                        src={sheet.attachment.url}
                        title={`Folha: ${sheet.attachment.name}`}
                      />
                    ) : (
                      <img
                        src={sheet.attachment.url}
                        alt={`Folha de ${professor.name}`}
                      />
                    )}
                  </div>
                </>
              )}

              {sheet.error && (
                <p
                  role="alert"
                  className="form-error"
                >
                  {sheet.error}
                </p>
              )}

              {!sheet.confirmedAt && (
                <div className="document-actions">
                  <Button
                    disabled={busy}
                    aria-busy={busy}
                    onClick={process}
                  >
                    {busy
                      ? 'Processando…'
                      : sheet.status === 'error'
                        ? 'Tentar novamente'
                        : 'Processar documento'}
                  </Button>

                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setManual(true);
                      setTarget(professor.id);
                      setPeriod(month);
                    }}
                  >
                    Selecionar professor manualmente
                  </Button>
                </div>
              )}

              {(sheet.status === 'identified' || manual) && (
                <section className="identified-panel">
                  <h2>
                    {manual ||
                    sheet.identificationSource === 'manual'
                      ? 'Conferência manual'
                      : 'Dados identificados'}
                  </h2>

                  {sheet.identifiedData && (
                    <dl>
                      <dt>Professor</dt>
                      <dd>
                        {sheet.identifiedData.professorName ||
                          'Não identificado'}
                      </dd>

                      <dt>Matrícula</dt>
                      <dd>
                        {sheet.identifiedData.registration ||
                          'Não identificada'}
                      </dd>

                      <dt>Competência</dt>
                      <dd>
                        {sheet.identifiedData.competence
                          ? monthLabel(
                              sheet.identifiedData.competence
                            )
                          : 'Não identificada'}
                      </dd>

                      <dt>Arquivo</dt>
                      <dd>{sheet.attachment.name}</dd>
                    </dl>
                  )}

                  {sheet.confirmedAt ? (
                    <div>
                      <p role="status">
                        <strong>Vínculo confirmado</strong>
                      </p>

                      <dl>
                        <dt>Professor</dt>
                        <dd>{professor.name}</dd>

                        <dt>Matrícula</dt>
                        <dd>{professor.registration}</dd>

                        <dt>Competência</dt>
                        <dd>{monthLabel(month)}</dd>
                      </dl>
                    </div>
                  ) : (
                    <>
                      <p>
                        Aguardando confirmação. Confira o documento original antes de confirmar o vínculo.
                      </p>

                      <label>
                        Professor para vínculo
                        <select
                          aria-label="Professor para vínculo"
                          value={target}
                          onChange={e => {
                            console.log(
                              'PROFESSOR ESCOLHIDO:',
                              e.target.value
                            );
                            setTarget(e.target.value);
                          }}
                        >
                          <option value="">
                            Selecione o professor
                          </option>

                          {professors.map(p => (
                            <option
                              key={p.id}
                              value={p.id}
                            >
                              {p.name} · {p.registration}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Competência para vínculo
                        <input
                          aria-label="Competência para vínculo"
                          type="month"
                          value={period}
                          onChange={e =>
                            setPeriod(e.target.value)
                          }
                        />
                      </label>

                      <Button
                        disabled={
                          busy ||
                          !target ||
                          !period
                        }
                        onClick={confirm}
                      >
                        Confirmar vínculo
                      </Button>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
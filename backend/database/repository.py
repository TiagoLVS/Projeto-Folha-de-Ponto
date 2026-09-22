from psycopg.rows import dict_row

from backend.database.connection import conectar


def listar_servidores():
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute("""
                SELECT id_servidor, nome, matricula, email, departamento, carga_horaria
                FROM servidor ORDER BY nome, id_servidor
            """)
            return cursor.fetchall()


def atualizar_servidor(id_servidor, nome, matricula, email, departamento, carga_horaria=None):
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute("""
                UPDATE servidor SET nome = %s, matricula = %s,
                    email = %s, departamento = %s, carga_horaria = %s
                WHERE id_servidor = %s
                RETURNING id_servidor, nome, matricula, email, departamento, carga_horaria
            """, (nome, matricula, email, departamento, carga_horaria, id_servidor))
            return cursor.fetchone()


def confirmar_folha(id_folha, id_servidor, mes, ano):
    """Corrige o vínculo atomicamente, preservando a leitura original do OCR."""
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT id_folha FROM folha_ponto WHERE id_folha = %s FOR UPDATE",
                (id_folha,),
            )
            if cursor.fetchone() is None:
                raise LookupError("Folha não encontrada.")
            cursor.execute(
                "SELECT id_servidor FROM servidor WHERE id_servidor = %s FOR KEY SHARE",
                (id_servidor,),
            )
            if cursor.fetchone() is None:
                raise LookupError("Professor não encontrado.")
            cursor.execute("""
                INSERT INTO competencia (mes, ano) VALUES (%s, %s)
                ON CONFLICT (mes, ano) DO UPDATE SET mes = EXCLUDED.mes
                RETURNING id_competencia
            """, (mes, ano))
            id_competencia = cursor.fetchone()["id_competencia"]
            # A restrição única também protege contra confirmações concorrentes.
            cursor.execute("""
                UPDATE folha_ponto
                SET id_servidor = %s, id_competencia = %s,
                    status_ocr = 'OK', mensagem_ocr = NULL
                WHERE id_folha = %s
                RETURNING id_folha, id_servidor, id_competencia, status_ocr
            """, (id_servidor, id_competencia, id_folha))
            return {**cursor.fetchone(), "competencia": f"{ano:04d}-{mes:02d}"}


def criar_servidor(nome, matricula, email, departamento, carga_horaria=None):
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT id_servidor FROM servidor WHERE matricula = %s",
                (matricula,),
            )
            if cursor.fetchone():
                return None
            cursor.execute(
                """
                INSERT INTO servidor (nome, matricula, email, departamento, carga_horaria)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id_servidor, nome, matricula, email, departamento, carga_horaria
                """,
                (nome, matricula, email, departamento, carga_horaria),
            )
            return cursor.fetchone()


def importar_servidores(registros):
    """Insere ou atualiza servidores importados de uma planilha validada."""
    with conectar() as conn:
        with conn.cursor() as cursor:
            for registro in registros:
                cursor.execute(
                    """
                    INSERT INTO servidor (
                        matricula, nome, cpf, email, carga_horaria, acumula_cargo
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (matricula) DO UPDATE SET
                        nome = EXCLUDED.nome,
                        cpf = EXCLUDED.cpf,
                        email = EXCLUDED.email,
                        carga_horaria = EXCLUDED.carga_horaria,
                        acumula_cargo = EXCLUDED.acumula_cargo
                    """,
                    (registro["matricula"], registro["nome"], registro["cpf"],
                     registro["email_pessoal"], registro["carga_horaria"],
                     registro["acumula_cargo"]),
                )
    return len(registros)


def buscar_servidor_por_matricula(matricula):
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT
                    id_servidor,
                    matricula,
                    nome,
                    cpf,
                    email,
                    acumula_cargo
                FROM servidor
                WHERE matricula = %s
                """,
                (matricula,),
            )

            return cursor.fetchone()


def obter_competencia(mes, ano):
    with conectar() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO competencia (mes, ano)
                VALUES (%s, %s)

                ON CONFLICT (mes, ano)
                DO UPDATE SET mes = EXCLUDED.mes

                RETURNING id_competencia
                """,
                (mes, ano),
            )

            return cursor.fetchone()[0]


def salvar_folha(
    id_servidor,
    id_competencia,
    caminho_arquivo,
    nome_arquivo,
    matricula_lida,
    competencia_lida,
    status_ocr,
    mensagem_ocr=None,
):
    with conectar() as conn:
        with conn.cursor() as cursor:

            if id_servidor is not None and id_competencia is not None:

                cursor.execute(
                    """
                    INSERT INTO folha_ponto (
                        id_servidor,
                        id_competencia,
                        caminho_arquivo,
                        nome_arquivo,
                        matricula_lida,
                        competencia_lida,
                        status_ocr,
                        mensagem_ocr,
                        data_processamento_ocr
                    )
                    VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, CURRENT_TIMESTAMP
                    )

                    ON CONFLICT (
                        id_servidor,
                        id_competencia
                    )
                    DO UPDATE SET
                        caminho_arquivo = EXCLUDED.caminho_arquivo,
                        nome_arquivo = EXCLUDED.nome_arquivo,
                        matricula_lida = EXCLUDED.matricula_lida,
                        competencia_lida = EXCLUDED.competencia_lida,
                        status_ocr = EXCLUDED.status_ocr,
                        mensagem_ocr = EXCLUDED.mensagem_ocr,
                        data_processamento_ocr = CURRENT_TIMESTAMP

                    RETURNING id_folha
                    """,
                    (
                        id_servidor,
                        id_competencia,
                        caminho_arquivo,
                        nome_arquivo,
                        matricula_lida,
                        competencia_lida,
                        status_ocr,
                        mensagem_ocr,
                    ),
                )

            else:

                cursor.execute(
                    """
                    INSERT INTO folha_ponto (
                        id_servidor,
                        id_competencia,
                        caminho_arquivo,
                        nome_arquivo,
                        matricula_lida,
                        competencia_lida,
                        status_ocr,
                        mensagem_ocr,
                        data_processamento_ocr
                    )
                    VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, CURRENT_TIMESTAMP
                    )
                    RETURNING id_folha
                    """,
                    (
                        id_servidor,
                        id_competencia,
                        caminho_arquivo,
                        nome_arquivo,
                        matricula_lida,
                        competencia_lida,
                        status_ocr,
                        mensagem_ocr,
                    ),
                )

            return cursor.fetchone()[0]


def buscar_folha_para_envio(id_folha):
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT
                    fp.id_folha,
                    fp.caminho_arquivo,
                    fp.status_ocr,
                    s.id_servidor,
                    s.matricula,
                    s.nome,
                    s.email,
                    s.acumula_cargo
                FROM folha_ponto fp

                JOIN servidor s
                    ON s.id_servidor = fp.id_servidor

                WHERE fp.id_folha = %s
                """,
                (id_folha,),
            )

            return cursor.fetchone()


def listar_folhas_para_envio(ano, mes, ids_servidores):
    with conectar() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """
                SELECT fp.id_folha, fp.caminho_arquivo, fp.status_ocr,
                       s.id_servidor, s.matricula, s.nome, s.email
                FROM folha_ponto fp
                JOIN servidor s ON s.id_servidor = fp.id_servidor
                JOIN competencia c ON c.id_competencia = fp.id_competencia
                WHERE c.ano = %s AND c.mes = %s
                  AND s.id_servidor = ANY(%s)
                """,
                (ano, mes, ids_servidores),
            )
            return cursor.fetchall()


def criar_envio(id_folha, email):
    with conectar() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO envio (
                    id_folha,
                    email_destino,
                    status_envio
                )
                VALUES (%s, %s, 'PENDENTE')
                RETURNING id_envio
                """,
                (id_folha, email),
            )

            return cursor.fetchone()[0]


def finalizar_envio(
    id_envio,
    status,
    mensagem_erro=None,
):
    with conectar() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE envio
                SET
                    status_envio = %s,

                    data_envio =
                        CASE
                            WHEN %s = 'ENVIADO'
                            THEN CURRENT_TIMESTAMP
                            ELSE NULL
                        END,

                    mensagem_erro = %s

                WHERE id_envio = %s
                """,
                (
                    status,
                    status,
                    mensagem_erro,
                    id_envio,
                ),
            )

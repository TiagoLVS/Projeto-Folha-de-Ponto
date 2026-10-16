"""Modelo provisório. Substitua renderizar_pdf para adotar um layout institucional."""
import calendar
from collections import defaultdict
from datetime import date
import pymupdf

TIPOS = {'FERIADO': 'Feriado', 'RECESSO': 'Recesso', 'PONTO_FACULTATIVO': 'Ponto facultativo', 'OUTRO': 'Outro'}
DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
MODELO_ID = 'provisorio-v1'
TITULO = 'FOLHA DE PONTO - MODELO PROVISÓRIO DA APLICAÇÃO'
ALTURA_MINIMA_LINHA = 18


def quebrar(text, width, size=8):
    lines = []
    for paragraph in text.split('\n'):
        line = ''
        for word in paragraph.split():
            # Divida também palavras muito longas, sem omitir o conteúdo.
            for char in (' ' if line else '') + word:
                if line and pymupdf.get_text_length(line + char, fontsize=size) > width:
                    lines.append(line); line = ''
                line += char
        lines.append(line)
    return lines or ['']


def renderizar_pdf(professor, competencia, eventos, versao):
    ano, mes = map(int, competencia.split('-'))
    por_dia = defaultdict(list)
    for evento in eventos:
        por_dia[evento['data']].append(f"{TIPOS[evento['tipo']]}: {evento['especificacao']}")
    doc = pymupdf.open()
    columns = [32, 96, 166, 237, 308, 563]
    page = None
    y = 0

    def nova_pagina():
        nonlocal page, y
        page = doc.new_page(width=595, height=842)
        page.insert_text((32, 35), TITULO, fontsize=12, fontname='hebo')
        y = 53
        metadata = [f"Professor: {professor['nome']}", f"Matrícula: {professor['matricula']}   |   Competência: {mes:02d}/{ano}   |   Versão: {versao}",
                    f"Departamento: {professor.get('departamento') or 'Não informado'}",
                    f"Carga horária cadastrada: {str(professor['carga_horaria']) + ' horas' if professor.get('carga_horaria') else 'Não informada'}"]
        for text in metadata:
            for line in quebrar(text, 525, 9):
                page.insert_text((32, y), line, fontsize=9); y += 12
        page.insert_text((32, y + 3), 'Horários e assinaturas devem ser preenchidos pelo responsável. Datas especiais não indicam frequência.', fontsize=7)
        y += 16
        page.draw_rect((32, y, 563, y + 20), fill=(.90, .94, .97), color=(.45, .5, .55))
        for x, title in zip(columns, ['Data', 'Dia da semana', 'Entrada', 'Saída', 'Observações']):
            page.insert_text((x + 4, y + 13), title, fontsize=8, fontname='hebo')
        y += 20
        page.insert_text((32, 820), f'Modelo {MODELO_ID} - Página {len(doc)}', fontsize=8)

    try:
        nova_pagina()
        for day in range(1, calendar.monthrange(ano, mes)[1] + 1):
            data = date(ano, mes, day)
            obs = por_dia[data].copy()
            if data.weekday() >= 5:
                obs.insert(0, 'Fim de semana')
            lines = quebrar('\n'.join(obs), 246)
            while lines:
                if y + 26 > 755:
                    nova_pagina()
                fit = max(1, int((755 - y - 10) / 11))
                chunk, lines = lines[:fit], lines[fit:]
                height = max(ALTURA_MINIMA_LINHA, len(chunk) * 11 + 7)
                fill = (.94, .94, .94) if data.weekday() >= 5 else (1, .98, .9) if por_dia[data] else (1, 1, 1)
                page.draw_rect((32, y, 563, y + height), color=(.65, .65, .65), fill=fill)
                for x in columns[1:-1]:
                    page.draw_line((x, y), (x, y + height), color=(.65, .65, .65))
                page.insert_text((36, y + 14), data.strftime('%d/%m/%Y'), fontsize=8)
                page.insert_text((100, y + 14), DIAS[data.weekday()], fontsize=8)
                for idx, line in enumerate(chunk):
                    page.insert_text((312, y + 14 + idx * 11), line, fontsize=8)
                y += height
        if y + 90 > 800:
            nova_pagina()
        page.insert_text((32, y + 20), 'Observações gerais: _____________________________________________________________', fontsize=9)
        page.insert_text((32, y + 54), '_______________________________       _______________________________', fontsize=10)
        page.insert_text((32, y + 70), 'Assinatura do professor                            Assinatura da chefia', fontsize=9)
        return doc.tobytes(garbage=4, deflate=True)
    finally:
        doc.close()

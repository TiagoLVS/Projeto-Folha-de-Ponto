"""Folha institucional A4 com grade, margens e espaçamentos uniformes."""
import calendar
from collections import defaultdict
from datetime import date
from pathlib import Path
import pymupdf

MODELO_ID = 'institucional-v2'
TIPOS = {'FERIADO':'Feriado','RECESSO':'Recesso','PONTO_FACULTATIVO':'Ponto facultativo','OUTRO':'Outro'}
MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']
LOGO = Path(__file__).resolve().parents[1] / 'assets' / 'undf-logo-institucional.jpg'
LEFT, RIGHT = 28, 567
PADDING = 8
MIDDLE = (LEFT + RIGHT) / 2
BODY_TOP, BODY_BOTTOM = 236, 682
FONTS = {'helv': pymupdf.Font('helv'), 'hebo': pymupdf.Font('hebo')}


def texto_pdf(value):
    return str(value).replace('–','-').replace('—','-')


def quebrar(text, width, size=8):
    result=[]
    for paragraph in texto_pdf(text).split('\n'):
        remaining=paragraph
        while remaining:
            end=1
            while end<len(remaining) and pymupdf.get_text_length(remaining[:end+1],fontsize=size)<=width:
                end+=1
            if end<len(remaining):
                boundary=remaining.rfind(' ',0,end+1)
                if boundary>0:end=boundary
            result.append(remaining[:end].rstrip())
            remaining=remaining[end:].lstrip()
        if not paragraph:result.append('')
    return result or ['']


def centralizar(page, rect, text, size=7, bold=False):
    """Centraliza usando as métricas da mesma fonte usada para desenhar."""
    rect=pymupdf.Rect(rect)
    text=texto_pdf(text)
    font='hebo' if bold else 'helv'
    while size>5 and FONTS[font].text_length(text,fontsize=size)>rect.width-6:
        size-=.25
    width=FONTS[font].text_length(text,fontsize=size)
    metrics=FONTS[font]
    baseline=(rect.y0+rect.y1)/2+(metrics.ascender+metrics.descender)*size/2
    page.insert_text(((rect.x0+rect.x1-width)/2,baseline),text,fontsize=size,fontname=font)


def renderizar_pdf(professor, competencia, eventos, versao):
    ano,mes=map(int,competencia.split('-'))
    byday=defaultdict(list)
    for event in eventos:
        byday[event['data']].append(f"{TIPOS[event['tipo']]}: {event['especificacao']}")
    doc=pymupdf.open()
    anexos_eventos,anexos_dados=[],[]
    columns=[LEFT,54,196.5,253.5,310.5,453,510,RIGHT]
    try:
        page=doc.new_page(width=595,height=842)
        def box(x,y,x2,y2,fill=None):
            page.draw_rect((x,y,x2,y2),color=(0,0,0),fill=fill,width=.45)

        # Bloco institucional: logo e texto têm áreas independentes e simétricas.
        box(LEFT,28,RIGHT,78)
        page.draw_line((106,28),(106,78),width=.45)
        page.insert_image((LEFT+5,33,101,73),filename=str(LOGO),keep_proportion=True)
        centralizar(page,(106,32,RIGHT,48),'UNIVERSIDADE DO DISTRITO FEDERAL',10,True)
        centralizar(page,(106,48,RIGHT,62),'PROF. JORGE AMAURY MAIA NUNES - UnDF',8.5,True)
        centralizar(page,(106,62,RIGHT,76),'CNPJ 43.061.297/0001-08',7.5)
        box(LEFT,78,RIGHT,98,(.95,.95,.95))
        page.draw_line((MIDDLE,78),(MIDDLE,98),width=.45)
        centralizar(page,(LEFT,78,MIDDLE,98),'REGISTRO DE FREQUÊNCIA',9.5,True)
        centralizar(page,(MIDDLE,78,RIGHT,98),f'REFERÊNCIA: {MESES[mes-1]}/{ano}',8.5,True)

        def campo(x,top,right,label,value=''):
            """Rótulo e valor em duas linhas: mesmos recuos e alturas em toda a grade."""
            box(x,top,right,top+22)
            page.insert_text((x+PADDING,top+8),label,fontsize=6.3,fontname='hebo',color=(.24,.24,.24))
            value=texto_pdf(value)
            width=right-x-2*PADDING
            size=8.5
            while size>7 and FONTS['helv'].text_length(value,fontsize=size)>width:
                size-=.25
            if '\n' in value or FONTS['helv'].text_length(value,fontsize=size)>width:
                anexos_dados.append((label,value))
                suffix=' [ver anexo]'
                value=value.replace('\n',' ')
                while value and FONTS['helv'].text_length(value+suffix,fontsize=size)>width:
                    value=value[:-1]
                value=value.rstrip()+suffix
            page.insert_text((x+PADDING,top+18),value,fontsize=size,fontname='helv')

        campo(LEFT,98,MIDDLE,'UA:',professor.get('ua') or '')
        campo(MIDDLE,98,RIGHT,'MATRÍCULA:',professor['matricula'])
        campo(LEFT,120,RIGHT,'NOME DO SERVIDOR:',professor['nome'])
        campo(LEFT,142,MIDDLE,'CARGO:',professor.get('cargo') or '')
        campo(MIDDLE,142,RIGHT,'PADRÃO:',professor.get('padrao') or '')
        campo(LEFT,164,MIDDLE,'FUNÇÃO:',professor.get('funcao') or '')
        campo(MIDDLE,164,RIGHT,'CARGA HORÁRIA:',f"{professor['carga_horaria']}h" if professor.get('carga_horaria') else '')
        campo(LEFT,186,RIGHT,'EXERCÍCIO:',professor.get('exercicio') or '')

        box(LEFT,208,RIGHT,BODY_TOP,(.9,.9,.9))
        page.draw_line((54,208),(54,BODY_TOP),width=.45)
        page.draw_line((310.5,208),(310.5,BODY_TOP),width=.45)
        page.draw_line((54,222),(RIGHT,222),width=.45)
        centralizar(page,(LEFT,208,54,BODY_TOP),'DIA',7,True)
        for x,end in [(54,310.5),(310.5,RIGHT)]:
            centralizar(page,(x,208,end,222),'TURNO',8,True)
        for x,end,label in zip(columns[1:-1],columns[2:],['ASSINATURA','ENTRADA','SAÍDA']*2):
            centralizar(page,(x,222,end,BODY_TOP),label,6.8,True)
            page.draw_line((x,222),(x,BODY_TOP),width=.45)

        # Altura total constante: meses de 28 a 31 dias terminam na mesma posição.
        days=calendar.monthrange(ano,mes)[1]
        height=(BODY_BOTTOM-BODY_TOP)/days
        for day in range(1,days+1):
            top=BODY_TOP+(day-1)*height
            bottom=BODY_TOP+day*height
            current=date(ano,mes,day)
            weekend='SÁBADO' if current.weekday()==5 else 'DOMINGO' if current.weekday()==6 else ''
            labels=([weekend] if weekend else [])+byday[current]
            text='; '.join(labels)
            lines=quebrar(text,columns[2]-columns[1]-2*PADDING,6.5)
            if len(lines)>2:
                anexos_eventos.append((current,text))
                lines=[f'EVENTOS DIA {day:02d}: VER ANEXO']
            box(LEFT,top,RIGHT,bottom,(.9,.9,.9) if labels else None)
            for x in columns[1:-1]:page.draw_line((x,top),(x,bottom),width=.4)
            centralizar(page,(LEFT,top,54,bottom),f'{day:02d}',7,True)
            if labels:
                for x,end in [(54,196.5),(310.5,453)]:
                    for index,line in enumerate(lines):
                        line_top=top+(height-len(lines)*6.5)/2+index*6.5
                        centralizar(page,(x,line_top,end,line_top+6.5),line,6.5,bool(weekend and not byday[current]))
                for x,end in [(196.5,253.5),(253.5,310.5),(453,510),(510,RIGHT)]:
                    centralizar(page,(x,top,end,bottom),'--',7)

        box(LEFT,BODY_BOTTOM,RIGHT,BODY_BOTTOM+12,(.95,.95,.95))
        page.insert_text((LEFT+PADDING,BODY_BOTTOM+8.5),'Observações:',fontsize=7,fontname='hebo')
        for offset in (12,24,36):box(LEFT,BODY_BOTTOM+offset,RIGHT,BODY_BOTTOM+offset+12)
        if anexos_eventos or anexos_dados:
            page.insert_text((LEFT+PADDING,BODY_BOTTOM+21),'Informações complementares: consultar anexo integrante desta folha.',fontsize=7)
        signature_top=BODY_BOTTOM+48
        box(LEFT,signature_top,RIGHT,signature_top+76)
        page.draw_line((MIDDLE,signature_top),(MIDDLE,signature_top+76),width=.45)
        for x,end,label in [(LEFT,MIDDLE,'ASSINATURA E CARIMBO DA CHEFIA IMEDIATA'),(MIDDLE,RIGHT,'ASSINATURA E CARIMBO DO SUPERIOR HIERÁRQUICO')]:
            centralizar(page,(x,signature_top+9,end,signature_top+26),'Em: ______/______/______',7.5)
            page.draw_line((x+22,signature_top+48),(end-22,signature_top+48),width=.45)
            centralizar(page,(x,signature_top+53,end,signature_top+69),label,6.2,True)
        page.insert_text((LEFT,826),f'Modelo {MODELO_ID} | Versão {versao} | Horários e assinaturas em branco',fontsize=6)
        page.insert_text((RIGHT-20,826),'UnDF',fontsize=6)

        if anexos_eventos or anexos_dados:
            def pagina_anexo():
                extra=doc.new_page(width=595,height=842)
                centralizar(extra,(LEFT,25,RIGHT,45),f'INFORMAÇÕES COMPLEMENTARES - {MESES[mes-1]}/{ano} - VERSÃO {versao}',8.5,True)
                return extra,62
            extra,top=pagina_anexo()
            records=[(label,value) for label,value in anexos_dados]
            records.extend((f'{current:%d/%m/%Y}',text) for current,text in anexos_eventos)
            for label,value in records:
                for line in quebrar(f'{label} {value}',RIGHT-LEFT,8):
                    if top>795:extra,top=pagina_anexo()
                    extra.insert_text((LEFT,top),line,fontsize=8);top+=12
                top+=8
        return doc.tobytes(garbage=4,deflate=True)
    finally:
        doc.close()

"""Modelo institucional A4 baseado na estrutura especificada para o registro UnDF."""
import calendar
from collections import defaultdict
from datetime import date
from pathlib import Path
import pymupdf

MODELO_ID = 'institucional-v1'
TIPOS = {'FERIADO':'Feriado','RECESSO':'Recesso','PONTO_FACULTATIVO':'Ponto facultativo','OUTRO':'Outro'}
MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']
LOGO = Path(__file__).resolve().parents[1] / 'assets' / 'undf-logo-institucional.jpg'


def quebrar(text, width, size=8):
    result=[]
    for paragraph in str(text).split('\n'):
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


def escrever(page,x,y,text,width,size=8,bold=False):
    font='hebo' if bold else 'helv'
    while size>5 and pymupdf.get_text_length(str(text),fontname=font,fontsize=size)>width:
        size-=.25
    for line in quebrar(str(text),width,size):
        page.insert_text((x,y),line,fontsize=size,fontname=font);y+=size+2
    return y


def centro(page,left,right,y,text,size=7,bold=False):
    font='hebo' if bold else 'helv'
    width=pymupdf.get_text_length(text,fontsize=size,fontname=font)
    page.insert_text(((left+right-width)/2,y),text,fontsize=size,fontname=font)


def renderizar_pdf(professor, competencia, eventos, versao):
    ano,mes=map(int,competencia.split('-'))
    byday=defaultdict(list)
    for event in eventos:
        byday[event['data']].append(f"{TIPOS[event['tipo']]}: {event['especificacao']}")
    doc=pymupdf.open();anexos=[]
    left,right=22,574
    columns=[22,44,202,256,310,468,521,574]
    try:
        page=doc.new_page(width=595,height=842)
        def box(x,y,x2,y2,fill=None): page.draw_rect((x,y,x2,y2),color=(0,0,0),fill=fill,width=.45)
        box(left,29,right,79);page.draw_line((92,29),(92,79),width=.45)
        page.insert_image((25,32,88,76),filename=str(LOGO),keep_proportion=True)
        title='UNIVERSIDADE DO DISTRITO FEDERAL PROF JORGE AMAURY MAIA NUNES - UnDF'
        centro(page,96,right,49,title,9,True)
        centro(page,96,right,65,'CNPJ 43.061.297/0001-08',9,True)
        box(left,79,right,93)
        centro(page,95,310,89,'REGISTRO DE FREQUÊNCIA',10,True)
        centro(page,310,565,89,f'REFERÊNCIA: {MESES[mes-1]}/{ano}',9,True)
        box(left,93,right,163)
        def campo(x,y,label,value='',width=400):
            page.insert_text((x,y),label,fontsize=7.5,fontname='hebo')
            offset=pymupdf.get_text_length(label,fontname='hebo',fontsize=7.5)+5
            escrever(page,x+offset,y,value,width-offset,7.5)
        campo(25,102,'UA:',width=65)
        campo(94,102,'MATRÍCULA:',professor['matricula'],width=465)
        campo(25,116,'NOME DO SERVIDOR:',professor['nome'],width=543)
        campo(25,130,'CARGO:',width=250);campo(253,130,'PADRÃO:',width=240)
        campo(25,144,'FUNÇÃO:',width=172)
        campo(200,144,'CARGA HORÁRIA:',f"{professor['carga_horaria']}h" if professor.get('carga_horaria') else '',width=340)
        campo(25,158,'EXERCÍCIO:',width=543)
        y=163
        box(left,y,right,y+30,(.73,.73,.73))
        page.draw_line((left,y+15),(right,y+15),width=.45)
        centro(page,left,310,y+10,'TURNO',8,True);centro(page,310,right,y+10,'TURNO',8,True)
        page.draw_line((310,y),(310,y+30),width=.45)
        centro(page,left,44,y+26,'DIA',7,True)
        for x,end,label in zip(columns[1:-1],columns[2:],['ASSINATURA','ENTRADA','SAÍDA']*2):
            centro(page,x,end,y+26,label,7,True)
            page.draw_line((x,y+15),(x,y+30),width=.45)
        y+=30
        for day in range(1,calendar.monthrange(ano,mes)[1]+1):
            current=date(ano,mes,day)
            weekend='SÁBADO' if current.weekday()==5 else 'DOMINGO' if current.weekday()==6 else ''
            labels=([weekend] if weekend else [])+byday[current]
            text='; '.join(labels)
            lines=quebrar(text,151,6.5)
            if len(lines)>2:
                anexos.append((current,text));lines=[f'EVENTOS DIA {day:02d}: VER ANEXO']
            box(left,y,right,y+15.3,(.75,.75,.75) if labels else None)
            for x in columns[1:-1]:page.draw_line((x,y),(x,y+15.3),width=.4)
            centro(page,left,44,y+10.8,f'{day:02d}',7,True)
            if labels:
                for x,end in [(44,202),(310,468)]:
                    if len(lines)==1:
                        centro(page,x,end,y+10.5,lines[0],7 if not byday[current] else 6.5,bool(weekend and not byday[current]))
                    else:
                        for index,line in enumerate(lines):page.insert_text((x+3,y+6.6+index*6.8),line,fontsize=6)
                for x,end in [(202,256),(256,310),(468,521),(521,574)]:centro(page,x,end,y+10.5,'--')
            y+=15.3
        box(left,y,right,y+15,(.85,.85,.85));page.insert_text((25,y+10),'Observações:',fontsize=7.5,fontname='hebo')
        for offset in (15,30,45):box(left,y+offset,right,y+offset+15)
        if anexos:page.insert_text((27,y+27),'Datas especiais extensas: consultar anexo integrante desta versão.',fontsize=7.5)
        y+=60
        box(left,y,right,y+83);page.draw_line((298,y),(298,y+83),width=.45)
        for x,end,label in [(left,298,'ASSINATURA E CARIMBO DA CHEFIA IMEDIATA'),(298,right,'ASSINATURA E CARIMBO DO SUPERIOR HIERÁRQUICO')]:
            centro(page,x,end,y+18,'Em: ______/______/______',7.5)
            page.draw_line((x+22,y+64),(end-22,y+64),width=.45)
            centro(page,x,end,y+73,label,6,True)
        page.insert_text((left,831),f'Modelo {MODELO_ID} | Versão {versao} | Horários e assinaturas em branco',fontsize=6)
        page.insert_text((482,min(y+91,821)),'UnDF',fontsize=7)
        if anexos:
            page=doc.new_page(width=595,height=842);top=43
            centro(page,30,565,25,f'DATAS ESPECIAIS - {MESES[mes-1]}/{ano} - VERSÃO {versao}',9,True)
            for current,text in anexos:
                for line in quebrar(f'{current:%d/%m/%Y} - {text}',530,8):
                    if top>790:page=doc.new_page(width=595,height=842);top=45
                    page.insert_text((30,top),line,fontsize=8);top+=12
                top+=8
        return doc.tobytes(garbage=4,deflate=True)
    finally:
        doc.close()

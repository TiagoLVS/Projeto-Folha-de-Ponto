import os
import subprocess
import sys
from pathlib import Path


def executar_etapa(nome, comando):
    print("\n" + "=" * 70)
    print(nome)
    print("=" * 70)

    try:
        subprocess.run(
            comando,
            check=True
        )

        print(f"\n✅ {nome} concluída.")
        return True

    except subprocess.CalledProcessError:
        print(f"\n❌ Erro durante: {nome}")
        return False


def main():
    print("\n" + "=" * 70)
    print("SISTEMA DE GESTÃO DE FOLHAS DE PONTO - DIGEP")
    print("=" * 70)

    # -------------------------------------------------
    # 1. Verifica o PDF informado
    # -------------------------------------------------

    if len(sys.argv) < 2:
        print(
            "\nUso:"
            '\npy main.py "caminho_do_pdf.pdf"'
        )
        return

    caminho_pdf = Path(sys.argv[1])

    if not caminho_pdf.exists():
        print(
            f"\n❌ PDF não encontrado: {caminho_pdf}"
        )
        return

    # -------------------------------------------------
    # 2. Processa a planilha de servidores
    # -------------------------------------------------

    if not os.path.exists("ler_planilha.py"):
        print("\n❌ Arquivo ler_planilha.py não encontrado.")
        return

    sucesso = executar_etapa(
        "ETAPA 1 - PROCESSAMENTO DA PLANILHA",
        [
            sys.executable,
            "ler_planilha.py"
        ]
    )

    if not sucesso:
        return

    # -------------------------------------------------
    # 3. Executa OCR
    # -------------------------------------------------

    if not os.path.exists("ocr_folhas.py"):
        print(
            "\n⚠️ ocr_folhas.py ainda não está no projeto."
        )
        print(
            "Assim que o módulo do OCR for adicionado, "
            "esta etapa funcionará automaticamente."
        )
        return

    sucesso = executar_etapa(
        "ETAPA 2 - OCR DAS FOLHAS DE PONTO",
        [
            sys.executable,
            "ocr_folhas.py",
            str(caminho_pdf)
        ]
    )

    if not sucesso:
        return

    # -------------------------------------------------
    # 4. Confere se as folhas foram geradas
    # -------------------------------------------------

    pasta_folhas = Path("folhas")

    if not pasta_folhas.exists():
        print(
            "\n❌ O OCR terminou, mas a pasta folhas "
            "não foi criada."
        )
        return

    folhas_geradas = list(
        pasta_folhas.glob("folha_*.pdf")
    )

    if not folhas_geradas:
        print(
            "\n❌ Nenhuma folha identificada pelo OCR."
        )
        return

    print(
        f"\n✅ {len(folhas_geradas)} folha(s) "
        "gerada(s) pelo OCR."
    )

    # -------------------------------------------------
    # 5. Executa envio de e-mails
    # -------------------------------------------------

    if not os.path.exists("enviar_email.py"):
        print("\n❌ Arquivo enviar_email.py não encontrado.")
        return

    sucesso = executar_etapa(
        "ETAPA 3 - ENVIO DAS FOLHAS POR E-MAIL",
        [
            sys.executable,
            "enviar_email.py"
        ]
    )

    if not sucesso:
        return

    # -------------------------------------------------
    # Final
    # -------------------------------------------------

    print("\n" + "=" * 70)
    print("✅ PROCESSAMENTO COMPLETO")
    print("=" * 70)

    print(
        "\nPlanilha processada"
        "\n→ OCR realizado"
        "\n→ Folhas identificadas"
        "\n→ PDFs separados"
        "\n→ Acumuladores identificados"
        "\n→ E-mails processados"
    )


if __name__ == "__main__":
    main()
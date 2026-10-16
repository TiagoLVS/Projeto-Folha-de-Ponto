import sys
from pathlib import Path

from backend.services.processar_folha import (
    processar_folha,
)


def main():

    if len(sys.argv) < 2:

        print(
            "\nUso:"
            '\npython3 -m backend.main "caminho_do_arquivo"'
        )

        print(
            "\nFormatos aceitos:"
            "\nPDF"
            "\nPNG"
            "\nJPG"
            "\nJPEG"
        )

        return

    caminho = Path(sys.argv[1])

    if not caminho.exists():

        print(
            f"\n❌ Arquivo não encontrado: {caminho}"
        )

        return

    print("\nPROCESSANDO DOCUMENTO")
    print("=" * 60)

    resultado = processar_folha(
        caminho
    )

    print(
        "\nStatus OCR:",
        resultado["status_ocr"],
    )

    print(
        "Matrícula:",
        resultado.get("matricula"),
    )

    print(
        "Competência:",
        resultado.get("competencia"),
    )

    if resultado.get("mensagem"):

        print(
            "Mensagem:",
            resultado["mensagem"],
        )

    print("\nTexto reconhecido:")
    print("-" * 60)

    print(
        resultado.get(
            "texto_ocr",
            "Texto não disponível."
        )
    )


if __name__ == "__main__":
    main()
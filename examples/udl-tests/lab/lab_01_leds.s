#
# UdL · Lab 01 — Encender LEDs (escritura MMIO)
# Escribe un patron al banco de LEDs (0xF0001008). Abre la pestana "Lab" y mira los LEDs.
#
.text
main:
    li   t0, 0xF0001008      # direccion DATA del banco de LEDs
    li   t1, 0xAA            # 1010 1010 -> se encienden los LEDs 1,3,5,7
    sw   t1, 0(t0)           # -> el banco de LEDs muestra el patron
    li   a7, 10
    ecall

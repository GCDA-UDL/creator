#
# UdL · Lab 05 — Display de 7 segmentos
# Pone el modo hex (ctrl 0xF0001020 = 2) y escribe un valor (0xF0001028).
#
.text
main:
    li   t0, 0xF0001020      # SEG ctrl = modo
    li   t1, 2               # 2 = hex
    sw   t1, 0(t0)
    li   t0, 0xF0001028      # SEG VALUE
    li   t1, 0xCAFE          # se muestra "CAFE"
    sw   t1, 0(t0)
    li   a7, 10
    ecall

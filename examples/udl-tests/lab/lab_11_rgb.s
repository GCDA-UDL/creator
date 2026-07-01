#
# UdL · Lab 11 — LED RGB (NeoPixel)
# DATA = 0x00RRGGBB. Recorre rojo -> verde -> azul -> amarillo con retardos.
# Observa el color del LED RGB en la pestaña Lab.
#
.text
main:
    li    s0, 0xF00010A8      # RGB DATA (0x00RRGGBB)
    li    t2, 250             # duración de cada color
    li    t0, 0xFF0000        # rojo
    sw    t0, 0(s0)
    li    t1, 0
r1:
    addi  t1, t1, 1
    blt   t1, t2, r1
    li    t0, 0x00FF00        # verde
    sw    t0, 0(s0)
    li    t1, 0
r2:
    addi  t1, t1, 1
    blt   t1, t2, r2
    li    t0, 0x0000FF        # azul
    sw    t0, 0(s0)
    li    t1, 0
r3:
    addi  t1, t1, 1
    blt   t1, t2, r3
    li    t0, 0xFFFF00        # amarillo
    sw    t0, 0(s0)
    li    a7, 10
    ecall

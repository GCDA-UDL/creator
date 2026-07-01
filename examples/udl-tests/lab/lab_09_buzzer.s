#
# UdL · Lab 09 — Buzzer (piezo)
# DATA bit0 enciende/apaga el zumbador. Suena, espera un poco y calla.
# Observa el estado "SONANDO/silencio" en la pestaña Lab.
#
.text
main:
    li    s0, 0xF0001088      # buzzer DATA
    li    t0, 1
    sw    t0, 0(s0)           # sonido ON
    li    t1, 0               # retardo corto
    li    t2, 300
d1:
    addi  t1, t1, 1
    blt   t1, t2, d1
    sw    zero, 0(s0)         # sonido OFF
    li    a7, 10
    ecall

#
# UdL · Cache 02 — Localidad TEMPORAL (re-lectura de la misma palabra)
# Esperado: 1er acceso = fallo COMPULSORY; los 7 restantes = ACIERTO.
#
.data
    x: .word 123
.text
main:
    la   t0, x
    li   t1, 0
    li   t2, 8
loop:
    beq  t1, t2, fin
    lw   t3, 0(t0)           # misma direccion -> HIT tras el 1er acceso
    addi t1, t1, 1
    j    loop
fin:
    li   a7, 10
    ecall

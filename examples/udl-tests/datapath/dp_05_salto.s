#
# UdL · Datapath 05 — Saltos condicionales e incondicional
# Observa la ruta de salto y la actualizacion del PC.
#
.text
main:
    addi t0, x0, 5
    addi t1, x0, 5
    beq  t0, t1, igual     # [B] TOMADO (5 == 5)
    addi t2, x0, 111       # (saltada)
igual:
    bne  t0, x0, sigue     # [B] TOMADO (5 != 0)
    addi t2, x0, 222       # (saltada)
sigue:
    jal  ra, fin           # [J] salto incondicional
    addi t2, x0, 333       # (saltada)
fin:
    li   a7, 10
    ecall

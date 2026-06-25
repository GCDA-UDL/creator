#
# UdL · Pipeline 04 — Penalizacion de salto tomado (riesgo de control)
# Salto resuelto en EX, prediccion "no tomado": si se toma -> Branch-taken stalls.
#
.text
main:
    addi t0, x0, 1
    beq  t0, t0, done      # TOMADO
    addi t1, x0, 111       # (saltada, entra al pipeline y se descarta)
done:
    addi t2, x0, 1
    li   a7, 10
    ecall

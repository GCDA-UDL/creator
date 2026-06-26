#
# UdL · Lab 02 — Contador binario en los LEDs
# Cuenta 0..15 y lo muestra en los LEDs. Con Step ves el incremento bit a bit.
#
.text
main:
    li   t0, 0xF0001008      # LED DATA
    li   t1, 0               # contador
    li   t2, 16
loop:
    beq  t1, t2, fin
    sw   t1, 0(t0)           # muestra el contador en los LEDs
    addi t1, t1, 1
    j    loop
fin:
    li   a7, 10
    ecall

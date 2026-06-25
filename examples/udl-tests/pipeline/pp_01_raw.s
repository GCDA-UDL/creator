#
# UdL · Pipeline 01 — Dependencia de datos RAW (read-after-write)
# Cycles: con FORWARDING ON, cadena ALU-ALU sin burbujas; preset "No forwarding" -> burbujas RAW.
#
.text
main:
    addi t0, x0, 5
    addi t1, t0, 1         # RAW sobre t0
    addi t2, t1, 1         # RAW sobre t1
    add  t3, t2, t1        # RAW sobre t2
    li   a7, 10
    ecall

#
# UdL · Pipeline 03 — Latencia del multiplicador (ocupa M1..M7)
# El dependiente del mul espera a que termine -> varias burbujas.
#
.text
main:
    addi t0, x0, 6
    addi t1, x0, 7
    mul  a0, t0, t1        # ocupa M1..M7 en la rejilla
    addi a1, a0, 1         # depende de a0 -> burbujas hasta M7
    li   a7, 10
    ecall

#
# UdL · Datapath 06 — Inmediato alto (formato U: lui / auipc)
# Estas instrucciones NO usan rs1; cargan un inmediato de 20 bits en la parte alta.
#
.text
main:
    lui   t0, 0x12345      # [U] t0 = 0x12345000
    auipc t1, 0            # [U] t1 = PC actual
    addi  t0, t0, 0x678    # completa: t0 = 0x12345678
    li    a7, 10
    ecall

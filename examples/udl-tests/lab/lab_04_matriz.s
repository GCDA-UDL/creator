#
# UdL · Lab 04 — Dibujar en la matriz LED 8x8
# Escribe 8 registros de fila (ROW0..ROW7, desde 0xF0001048, +4 por fila).
# MSB = columna izquierda. Este patron dibuja un rombo.
#
.text
main:
    li   t0, 0xF0001048      # ROW0
    li   t1, 0x18            #    ##
    sw   t1, 0(t0)
    li   t1, 0x3C            #   ####
    sw   t1, 4(t0)
    li   t1, 0x7E            #  ######
    sw   t1, 8(t0)
    li   t1, 0xFF            # ########
    sw   t1, 12(t0)
    li   t1, 0xFF            # ########
    sw   t1, 16(t0)
    li   t1, 0x7E            #  ######
    sw   t1, 20(t0)
    li   t1, 0x3C            #   ####
    sw   t1, 24(t0)
    li   t1, 0x18            #    ##
    sw   t1, 28(t0)
    li   a7, 10
    ecall

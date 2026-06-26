#
# UdL · Lab COMPLETO — todos los perifericos a la vez
# LEDs + 7-seg + matriz + lectura de switches. Abre la pestana "Lab".
#
.text
main:
    # --- 7-seg en modo hex, valor 0x0042 ---
    li   t0, 0xF0001020
    li   t1, 2
    sw   t1, 0(t0)
    li   t0, 0xF0001028
    li   t1, 0x0042
    sw   t1, 0(t0)

    # --- LEDs = 0xAA ---
    li   t0, 0xF0001008
    li   t1, 0xAA
    sw   t1, 0(t0)

    # --- matriz: una flecha hacia la derecha ---
    li   t0, 0xF0001048
    li   t1, 0x10
    sw   t1, 0(t0)
    li   t1, 0x18
    sw   t1, 4(t0)
    li   t1, 0xFF
    sw   t1, 8(t0)
    li   t1, 0xFF
    sw   t1, 12(t0)
    li   t1, 0x18
    sw   t1, 16(t0)
    li   t1, 0x10
    sw   t1, 20(t0)
    li   t1, 0x00
    sw   t1, 24(t0)
    li   t1, 0x00
    sw   t1, 28(t0)

    # --- leer switches (entrada) ---
    li   t0, 0xF0001018
    lw   t2, 0(t0)

    li   a7, 10
    ecall

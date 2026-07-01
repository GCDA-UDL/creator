#
# UdL · Lab 12 — Timer periódico por INTERRUPCION (ISR)
# El timer periférico (PIT) levanta una interrupción EXTERNAL cada "periodo" ciclos;
# la ISR (vía mtvec) incrementa el contador de LEDs y limpia el flag pendiente.
# REQUISITO: Settings -> Interrupt handler -> "Custom (architecture)".
# Uso: pon Run -> los LEDs cuentan los ticks del timer. (La ISR va antes de main:
# porque el ensamblador de CREATOR no admite referencias adelantadas.)
# Nota: este es el timer *periférico*; CREATOR también tiene el timer de máquina por
# CSR (mtime/mtimecmp, causa Timer) — ver tests/manual/06-lab.md para esa vía avanzada.
#
.text
isr:                           # rutina de servicio de interrupción
    li    t0, 0xF0001008       # LED DATA
    lw    t1, 0(t0)
    addi  t1, t1, 1            # cuenta los ticks del timer en los LEDs
    sw    t1, 0(t0)
    li    t0, 0xF00010B4       # timer STATUS
    sw    zero, 0(t0)          # limpia el flag pendiente
    mret                       # vuelve al punto interrumpido

main:
    li    t0, 8
    csrrw zero, mstatus, t0    # mstatus.MIE = 1 (interrupciones globales)
    li    t0, 0x800
    csrrw zero, mie, t0        # mie.MEIE = 1 (externa, bit 11)
    la    t0, isr
    csrrw zero, mtvec, t0      # vector de interrupción (modo directo)

    li    t0, 0xF00010B8       # timer DATA = periodo (ciclos)
    li    t1, 40
    sw    t1, 0(t0)
    li    t0, 0xF00010B0       # timer CTRL
    li    t1, 1
    sw    t1, 0(t0)            # bit0 = on -> IRQ cada 40 ciclos

    li    s0, 0                # trabajo acotado (para que Run termine)
    li    s1, 500
wait:
    addi  s0, s0, 1
    blt   s0, s1, wait
    li    a7, 10
    ecall

#
# UdL · Lab 06 — Pulsador por INTERRUPCION (ISR)
# Al pulsar el botón (pestaña Lab) se genera una interrupción EXTERNAL; la ISR
# (vía mtvec) incrementa el contador de LEDs.
# REQUISITO: Settings -> Interrupt handler -> "Custom (architecture)".
# Uso: haz Step por el bucle de espera y PULSA el botón -> la ISR salta y suma 1 a los LEDs.
# (La ISR se define ANTES de main: el ensamblador de CREATOR no admite referencias adelantadas.)
#
.text
isr:                           # rutina de servicio de interrupción
    li    t0, 0xF0001008       # LED DATA
    lw    t1, 0(t0)
    addi  t1, t1, 1            # incrementa el contador mostrado en los LEDs
    sw    t1, 0(t0)
    li    t0, 0xF0001038       # botón DATA
    sw    zero, 0(t0)          # limpia el flag de pulsado
    mret                       # vuelve al punto interrumpido

main:
    # mstatus.MIE = 1 (interrupciones globales). Idiom read-modify-write (t0 empieza en 0).
    csrrw zero, mstatus, t0
    ori   t0, t0, 8
    csrrw zero, mstatus, t0

    # mie.MEIE = 1 (interrupción externa, bit 11 = 0x800)
    li    t0, 0x800
    csrrw zero, mie, t0

    # mtvec = dirección de la ISR (modo directo)
    la    t0, isr
    csrrw zero, mtvec, t0

    # bucle de "trabajo" acotado (para que Run termine); pulsa el botón durante Step
    li    s0, 0
    li    s1, 400
wait:
    addi  s0, s0, 1
    blt   s0, s1, wait
    li    a7, 10
    ecall

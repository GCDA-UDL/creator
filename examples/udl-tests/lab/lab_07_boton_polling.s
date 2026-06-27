#
# UdL · Lab 07 — Pulsador por SONDEO (polling)
# Lee el estado del botón (0xF0001038) en bucle y enciende el LED 0 mientras está pulsado.
# Contrasta con la versión por interrupción (lab_06): aquí la CPU pregunta continuamente.
# Uso: haz Step y PULSA el botón -> el LED 0 se enciende mientras lo mantienes.
#
.text
main:
    li    t0, 0xF0001038       # botón DATA
    li    t1, 0xF0001008       # LED DATA
    li    t3, 0
    li    t4, 200
loop:
    beq   t3, t4, fin
    lw    t2, 0(t0)            # lee el botón (bit0 = pulsado)
    sw    t2, 0(t1)            # refleja en el LED 0
    addi  t3, t3, 1
    j     loop
fin:
    li    a7, 10
    ecall

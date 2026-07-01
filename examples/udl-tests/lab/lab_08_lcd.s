#
# UdL · Lab 08 — LCD 16x2 (protocolo de comando)
# Escribe "HOLA UDL" en el LCD. Protocolo tipo consola: se pone el carácter en
# DATA y se "pulsa" CTRL con el comando; el periférico lo consume y limpia CTRL.
#   CTRL = 1 -> escribe el carácter de DATA en el cursor (el cursor avanza)
#   CTRL = 2 -> borra la pantalla (cursor -> 0)
#   CTRL = 3 -> mueve el cursor a la posición DATA (0..31)
# Cada carácter se guarda como una palabra (.word) para no depender de lbu/.asciz.
#
.data
chars: .word 72, 79, 76, 65, 32, 85, 68, 76, 0   # 'H','O','L','A',' ','U','D','L', fin
.text
main:
    li    s0, 0xF0001078      # LCD DATA
    li    s1, 0xF0001070      # LCD CTRL
    li    t0, 2               # comando: borrar
    sw    t0, 0(s1)
    la    s2, chars
loop:
    lw    t1, 0(s2)           # siguiente carácter
    beq   t1, zero, done      # 0 = fin de cadena
    sw    t1, 0(s0)           # DATA = carácter
    li    t2, 1
    sw    t2, 0(s1)           # CTRL = 1 (escribe en el cursor)
    addi  s2, s2, 4           # siguiente palabra
    j     loop
done:
    li    a7, 10
    ecall

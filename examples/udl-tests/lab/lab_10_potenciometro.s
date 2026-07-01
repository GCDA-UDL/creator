#
# UdL · Lab 10 — Potenciómetro (entrada analógica)
# El potenciómetro (pestaña Lab) fija un valor 0..1023 que el programa lee con lw.
# Aquí se escala a un byte y se refleja en el banco de LEDs.
# Uso: pon Run y GIRA el potenciómetro -> los LEDs siguen la posición.
#
.text
main:
    li    s0, 0xF0001098      # potenciómetro DATA (0..1023, entrada)
    li    s1, 0xF0001008      # LED DATA
    li    s2, 0
    li    s3, 3000
loop:
    lw    t0, 0(s0)           # lee el potenciómetro
    srli  t0, t0, 2           # 0..1023 -> 0..255 (byte de LEDs)
    sw    t0, 0(s1)           # refleja en los LEDs
    addi  s2, s2, 1
    blt   s2, s3, loop        # gira durante el bucle
    li    a7, 10
    ecall

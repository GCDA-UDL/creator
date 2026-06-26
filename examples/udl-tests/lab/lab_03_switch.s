#
# UdL · Lab 03 — Leer switches y reflejarlos en los LEDs
# Lee los switches (0xF0001018) y los copia a los LEDs. En la pestana Lab, conmuta
# un switch y haz Step: el LED correspondiente se enciende (entrada por MMIO).
#
.text
main:
    li   t0, 0xF0001018      # SWITCHES DATA (lectura)
    li   t1, 0xF0001008      # LED DATA (escritura)
    li   t3, 0
    li   t4, 8
loop:
    beq  t3, t4, fin
    lw   t2, 0(t0)           # lee el estado de los switches
    sw   t2, 0(t1)           # lo refleja en los LEDs
    addi t3, t3, 1
    j    loop
fin:
    li   a7, 10
    ecall

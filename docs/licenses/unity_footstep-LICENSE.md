# dropecho/unity_footstep — MIT

Referência consultada para a detecção de passo por pose em `src/animation/FootstepSync.ts`.

- Repositório: https://github.com/dropecho/unity_footstep
- Commit lido: `2e3620087499c86b45b83811739f9a7e0db5d7c0`
- Arquivo lido: `Runtime/FootStepDetector.cs`
- Clone local (fora do build): `.tools/references/unity_footstep`

O que foi aproveitado é a **ideia** da máquina de estados — o pé precisa ser marcado como fora do
chão antes de um contato valer, e o contato só conta quando o pé está descendo. Nenhum código foi
transcrito: a referência é C#/Unity e depende de `Animator`/`HumanBodyBones`, que não existem aqui.
Nenhum som, amostra ou asset do repositório foi copiado, e nenhum script dele foi executado.

A cópia da licença vai abaixo por precaução, já que a ideia veio de lá.

---

## LICENSE

Copyright 2023 Benjamin Van Treese

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the “Software”), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { contextBridge, ipcRenderer } from 'electron';

/**
 * A ponte entre a descoberta (processo principal) e a lista de salas (página).
 *
 * É deliberadamente MÍNIMA: só ler a lista e ser avisado quando ela muda. Com
 * `contextIsolation`, nada além do que está aqui existe para a página — então uma dependência do
 * cliente comprometida não ganha o sistema de arquivos do jogador junto.
 *
 * O cliente usa isto quando existe (`window.riscoDeFruta`) e ignora quando não existe: no
 * navegador, em `npm run dev`, a lista continua sendo a do servidor ligado. Assim o mesmo código
 * de interface serve aos dois caminhos.
 */
export interface AnfitriaoLan {
  readonly nome: string;
  readonly endereco: string;
  readonly porta: number;
  readonly id: string;
  readonly versao: number;
}

contextBridge.exposeInMainWorld('riscoDeFruta', {
  empacotado: true,
  anfitrioes: (): Promise<AnfitriaoLan[]> => ipcRenderer.invoke('rdf:anfitrioes') as Promise<AnfitriaoLan[]>,
  aoMudarAnfitrioes: (ouvinte: (anfitrioes: AnfitriaoLan[]) => void): (() => void) => {
    const envelope = (_evento: unknown, lista: AnfitriaoLan[]): void => ouvinte(lista);
    ipcRenderer.on('rdf:anfitrioes', envelope);
    // Devolver o cancelador não é zelo: a tela de multijogador é montada e desmontada a cada ida ao
    // menu, e sem remover o ouvinte cada volta somaria mais um — a lista seria redesenhada N vezes.
    return () => { ipcRenderer.removeListener('rdf:anfitrioes', envelope); };
  },
});

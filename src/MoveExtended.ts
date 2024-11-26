/*
Rond point :
E	1355826.630	Longitude		-1.546229996
N	6233629.766	47.212662998	47.212662998

Devant accessoire : 
E	1355839.855	Longitude  	-1.546028772
N	6233594.600	Latitude 	47.212354093

*/

import {
    Vector3,
    BatchObject,
    Extension,
    IViewer,
    TreeNode,
    NodeRenderView,
  } from '@speckle/viewer';
  
  /** Simple animation data interface */
  interface Animation {
    target: BatchObject;
    start: Vector3;
    end: Vector3;
    current: Vector3;
    time: number;
  }
  
  export class MoveExtended extends Extension {
    /** We'll store our animations here */
    private _animations: Animation[] = [];
  
    /** Animation params */
    private readonly animTimeScale: number = 0.25;
  
    public constructor(viewer: IViewer) {
      super(viewer);
      // Initialisation éventuelle
      this._animations = [];
    }
  
    public MoveTreeNode(
      targetTreeNode: TreeNode,
      targetVector: Vector3,
      targetStartVector: Vector3
    ) {
      console.group('MoveTreeNode');
      console.log('Node elementid :', targetTreeNode.model.raw.elementId);
      console.log('Started position is  :', targetStartVector);
      console.log('Translation is translation is :', targetVector);
      console.groupEnd();
  
      /** Get the render views */
      const renderTree = this.viewer.getWorldTree().getRenderTree();
      const rvs: NodeRenderView =
        renderTree.getRenderViewsForNode(targetTreeNode);
  
      /** Get the batch objects which we'll animate */
      const objects = rvs
        .map((rv: NodeRenderView) => this.viewer.getRenderer().getObject(rv))
        .filter((obj: BatchObject) => obj !== null);
  
      //console.log("Move at", targetVector);
  
      objects.forEach((obj: BatchObject) => {
        this._animations.push({
          target: obj,
          start: targetStartVector,
          end: targetVector,
          current: new Vector3(),
          time: 0,
        });
      });
    }
  
    /** We're tying in to the viewer core's frame event */
    public onLateUpdate(deltaTime: number) {
      if (!this._animations || !this._animations.length) return;
  
      let animCount = 0;
  
      for (let k = 0; k < this._animations.length; k++) {
        const anim = this._animations[k];
  
        /** Si l'animation est terminée */
        if (anim.time >= 1) {
          // Remettre l'animation à l'état initial pour éviter de la mettre à jour à nouveau
          anim.time = 1;
          continue;
        }
  
        /** Calculer la prochaine valeur de temps d'animation */
        const t = anim.time + deltaTime * this.animTimeScale;
        anim.time = Math.min(t, 1); // Clamper à 1
  
        /** Calculer la valeur actuelle de position basée sur le temps d'animation */
        const value = new Vector3()
          .copy(anim.start)
          .lerp(anim.end, this.easeInOutQuint(anim.time));
  
        /** Appliquer la translation */
        //const translation = value.sub(anim.current); // Calculer la différence par rapport à la position actuelle
        anim.target.transformTRS(value, undefined, undefined, undefined);
  
        /** Mettre à jour la position actuelle */
        anim.current.copy(value);
  
        animCount++;
      }
  
      /** If any animations updated, request a render */
      if (animCount) this.viewer.requestRender();
    }
  
    public onRender() {
      // NOT IMPLEMENTED for this example
    }
    public onResize() {
      // NOT IMPLEMENTED for this example
    }
  
    /** Simple utility easing function */
    private easeInOutQuint(x: number): number {
      return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
    }
  }
  
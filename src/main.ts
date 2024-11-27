import {
  Viewer,
  DefaultViewerParams,
  SpeckleLoader,
  UrlHelper,
  TreeNode,
  FilteringExtension,
  SelectionEvent,
  CameraController,
  MeasurementsExtension,
  CameraEvent,
  MeasurementType,
  NodeRenderView,
  Units,
  ViewerEvent,
  BatchObject,
  SelectionExtension,
  Vector3,
  NodeData,
} from '@speckle/viewer';

//import { makeMeasurementsUI } from './MeasurementsUI'; // Interface utilisateur pour les mesures
//import { Box3 } from 'three'; // Utilisé pour gérer des boîtes englobantes en 3D
import { Pane } from 'tweakpane'; // Bibliothèque pour créer une interface utilisateur (boutons, menus, etc.)

import { MoveExtended } from './MoveExtended';
// Or import only the bits you need
import * as maptilersdk from '@maptiler/sdk';
import axios from 'axios';

// Importez la configuration Firebase depuis env.ts
import { firebaseConfig } from './env';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';

//#region variablesGlobales

export const measurementsParams = {
  type: MeasurementType.POINTTOPOINT,
  vertexSnap: true,
  units: 'm',
  precision: 2,
  visible: true,
  enabled: false,
};

const paramCheckCoordinates = {
  toggle: false, // Valeur initiale (false pour "off")
};

interface Param {
  id: string;
  name: string;
  units: number;
  value: string;
  speckletype: string;
}

let refreshIntervalId : number; // Variable pour stocker l'ID de l'intervalle
let refreshBlade = null; // Déclarez refreshBlade ici pour qu'il soit accessible globalement
let gpsFollow = null;
let supportBlade = null;
let folderCoordinates = null; // Déclarer explicitement le type de la variable = null;

let btnUrlDoc = null;
let btnUrlPano = null;
let elementIdLabel = null;

// Coordonnées à retrancher car en 0 c'est ceci
let dx = 1384621.254; // Exemple de valeur à retrancher de x_transformed
let dy = 6251751.146; // Exemple de valeur à retrancher de y_transformed
let dz = 18.3; //à retrancher

// Définir le type de l'objet contenant TreeNode et Box3
type TypeRevitSpeckle = {
  node: TreeNode;
  currentCenter: Vector3;
  transformations: Vector3;
  batchObjects: BatchObject[]; // Liste des objets batch associés
};

let _treeNodeSelected: TreeNode | null = null;

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

document.addEventListener('DOMContentLoaded', () => {
  updateImage(''); // Masque le conteneur d'image au démarrage
});

// Fonction pour mettre à jour l'image
function updateImage(imageUrl: string) {
  const imagePreview = document.getElementById('image-preview');
  if (!imagePreview) return;

  imagePreview.innerHTML = ''; // Clear previous content

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Preview';
    imagePreview.appendChild(img);
    imagePreview.style.display = 'block';
  } else {
    imagePreview.style.display = 'none';
  }
}


async function main() {
  /** Get the HTML container */
  const container = document.getElementById('renderer') as HTMLElement;

  // Afficher le spinner au chargement initial
  const spinnerContainer = document.getElementById('spinner-container');
  if (spinnerContainer) {
    spinnerContainer.style.display = 'block';
  }

  //#region image

  const image_url_params = {
    factor: 123,
    title: 'hello',
    color: '#ff0055',
    image: '',
  };

  // Créer un élément img pour la miniature dans le panneau
  const imgInPane = document.createElement('img');
  imgInPane.style.maxWidth = '100%';
  imgInPane.style.height = 'auto';
  imgInPane.src = image_url_params.image;

  // Créer un conteneur pour l'image dans le panneau
  const containerInPane = document.createElement('div');
  containerInPane.style.padding = '8px';
  containerInPane.appendChild(imgInPane);

  // Créer un élément img pour la miniature sous le panneau
  const imgOutsidePane = document.createElement('img');
  imgOutsidePane.src = image_url_params.image;

  // Ajouter l'image sous le panneau
  const imagePreviewContainer = document.getElementById('image-preview');
  if (imagePreviewContainer) {
    imagePreviewContainer.appendChild(imgOutsidePane);
  }

  //#endregion

  //#region viewerparams

  /** Configurer les paramètres du viewer */
  const params = DefaultViewerParams;
  params.verbose = true;
  /** Create Viewer instance */
  const viewer = new Viewer(container, params);
  /** Initialise the viewer */
  await viewer.init();

  //#endregion

  //SpeckleExtensions
  const {
    cameraController,
    selection,
    measurements,
    measurementsExtension,
    moveExtension,
    filtering,
  } = initializeExtensions(viewer);

  //#region SpeckleLoad
  const resource =
    'https://app.speckle.systems/projects/f57e528fea/models/be8dfa0771';

  try {
    /** Create a loader for the speckle stream */
    const urls = await UrlHelper.getResourceUrls(resource);

    // Fonction pour charger un objet Speckle
    async function loadSpeckleObject(url: string) {
      const loader = new SpeckleLoader(viewer.getWorldTree(), url, '');
      await viewer.loadObject(loader, true);
    }

    // Charge tous les objets Speckle en parallèle
    await Promise.all(urls.map(loadSpeckleObject));

    // Cache le spinner après le chargement
    if (spinnerContainer) {
      spinnerContainer.style.display = 'none';
    }
  } catch (error) {
    console.error('Erreur de chargement des données : ', error);
    // Gérer les erreurs de chargement
    // Exemple : Afficher un message d'erreur ou réessayer le chargement
  }

  //OST_SpecialityEquipment
  // Map pour indexer les TreeNode par elementId
  const treeNodeSEqMap = new Map<string, TreeNode>();

  /** Find the 'level.name' property info*/
  const SpecialityEquipmentNodes = viewer
    .getWorldTree()
    .findAll((node: TreeNode) => {
      if (!node.model.raw.category) return;
      if (!node.model.atomic) return;
      return node.model.raw.category.includes('Specialty Equipment');
    });

  // Remplir la Map
  SpecialityEquipmentNodes.forEach((node) => {
    treeNodeSEqMap.set(node.model.raw.elementId, node);
  });

  //OST_GenericModels
  // Map pour indexer les TreeNode par elementId
  const treeNodeGMMap = new Map<string, TreeNode>();

  const GenericModelsNodes = viewer.getWorldTree().findAll((node: TreeNode) => {
    if (!node.model.raw.category) return;
    if (!node.model.atomic) return;
    return node.model.raw.category.includes('Generic Models');
  });

  // Remplir la Map
  GenericModelsNodes.forEach((node) => {
    treeNodeGMMap.set(node.model.raw.elementId, node);
  });

  let typeRevitSpeckles = null;
  typeRevitSpeckles = getTypeRevitSpeckles(SpecialityEquipmentNodes);

  //#endregion

  //#region PaneCreation
  const pane = new Pane({
    title: 'UI',
    expanded: true,
    container: document.getElementById('tweakpane-container'),
  });

  const folderTools = (pane as any).addFolder({
    title: 'Tools',
    expanded: true,
  });

  (pane as any)
  .addBlade({
    view: 'separator',
  });

  folderCoordinates = (pane as any).addFolder({
    title: 'Support informations',
    expanded: true,
  });

  (pane as any)
    .addBlade({
    view: 'separator',
  });

  const folderMesurements = (pane as any).addFolder({
    title: 'Mesurements',
    expanded: false,
  });

  //#endregion

  //#region folderTools
  folderTools
    .addButton({
      title: 'Isolate 360 views',
    })
    .on('click', () => {
      const filteringState = filtering.isolateObjects(
        GenericModelsNodes.map((node: TreeNode) => node.model.id)
      );
      console.log(`Isolated objects: ${filteringState.hiddenObjects}`);
    });
  folderTools
    .addButton({
      title: 'Isolate Specialty Equipment',
    })
    .on('click', () => {
      const filteringState = filtering.isolateObjects(
        SpecialityEquipmentNodes.map((node: TreeNode) => node.model.id)
      );
      console.log(`Isolated objects: ${filteringState.hiddenObjects}`);
    });
  folderTools
    .addButton({
      title: 'Reset',
    })
    .on('click', () => {
      filtering.resetFilters();
    });

  folderTools.addBlade({
    view: 'separator',
  });
  folderTools
    .addButton({
      title: 'Take a screenshot',
    })
    .on('click', () => {
      takeScreenshot();
    });

  folderTools
    .addBlade({
      view: 'list',
      label: 'Views',
      options: [
        { text: 'General', value: 'general' },
        { text: 'Center', value: '556473' },
        { text: 'South', value: '557614' },
        { text: 'West', value: '557663' },
        { text: 'East', value: '557739' },
        { text: 'North  ', value: '557705' },
      ],
      value: 'general',
    })
    .on('change', (ev: { value: string }) => {
      let elementid: string = '';
      let tnFinded: TreeNode = null;
      if (!GenericModelsNodes) return;

      switch (ev.value) {
        case 'general':
          //selection.enabled = true;
          selection.clearSelection();
          //selection.clearSelection();
          cameraController.setCameraView([], false);
          // Mettre à jour le bouton avec le nouveau paramètre URL_DOC trouvé
          updateButtonWithUrlForPano(null);
          break;
        default:
          // Rechercher dans cette liste le TreeNode avec l'elementId correspondant.
          //console.log(ev.value);
          // Rechercher dans cette liste le TreeNode avec l'elementId correspondant.
          tnFinded = treeNodeGMMap.get(ev.value);
      }

      if (tnFinded) {
        ZoomOnTreeNode(tnFinded);
        _treeNodeSelected = tnFinded;
        //RefreshTreeNodeSelected();
        //const id = tnFinded.model.id;
      } else {
        console.log(
          `Impossible de trouver le node pour l'elementid ${elementid}`
        );
      }
    });

  btnUrlPano = folderTools
    .addButton({
      title: '...',
      disabled: true,
      label: 'panoramic', // optional
    })
    .on('click', () => {
      // L'action de clic initial est vide, car l'URL sera mise à jour plus tard
    });
  //#endregion

  //#region GPSCoordinates
  supportBlade = folderCoordinates.addBlade({
    view: 'list',
    label: 'Support',
    options: [], // Initialement vide, sera rempli plus tard
    value: '', // Sélection initiale
  });

  // Ajoutez un contrôle toggle (on/off) au dossier
  const gpsFollow = folderCoordinates
    .addBinding(paramCheckCoordinates, 'toggle', {
      label: 'Suivi GPS',
    })
    .on('change', (ev: { value: any }) => {
      const selectedElementId = supportBlade.value; // Récupérer la valeur actuelle de supportBlade

      if (ev.value) {
        // Si toggle est activé (true)
        if (selectedElementId === 'null') {
          // Vérifier si aucun support n'est sélectionné
          console.log(
            "Impossible d'activer le Suivi GPS sans sélectionner un support valide."
          );

          // Remettre le toggle à false en modifiant directement paramCheckCoordinates
          paramCheckCoordinates.toggle = false;
          gpsFollow.refresh(); // Rafraîchir l'affichage du toggle
          return;
        }
        startFunctionWithInterval();
      } else {
        // Si toggle est désactivé (false), arrêter la fonction
        stopFunctionWithInterval();
      }
    });

  refreshBlade = folderCoordinates
    .addBlade({
      view: 'list',
      label: 'Refresh time',
      options: [
        { text: '3 s', value: '3000' },
        { text: '5 s', value: '5000' },
        { text: '10 s', value: '10000' },
      ],
      value: '3000',
    })
    .on('change', (ev: { value: any }) => {
      console.log('Temps de rafraîchissement sélectionné:', ev.value);

      if (paramCheckCoordinates.toggle) {
        // Si toggle est activé, redémarrer la fonction avec le nouvel intervalle
        stopFunctionWithInterval(); // Arrêter l'ancien intervalle
        startFunctionWithInterval(); // Démarrer avec le nouvel intervalle
      }
    });

  // Fonction pour créer et remplir la liste déroulante
  async function populateDropdown() {
    // Récupérer les données
    const commentsList = await fetchCommentsAndElementIds();

    // Convertir les données en options pour la liste déroulante
    const options = Object.keys(commentsList).map((elementId) => ({
      text:
        elementId === 'null' ? 'Support ?' : commentsList[elementId].comment,
      value: elementId,
      image_url: commentsList[elementId].image_url,
    }));

    // Forcer l'élément par défaut à être en tête de liste
    options.sort((a, b) => {
      if (a.value === 'null') return -1; // "Quel est votre support ?" en premier
      if (b.value === 'null') return 1;
      return 0;
    });

    // Ajouter la liste déroulante au panneau Tweakpane
    supportBlade.options = options;
    supportBlade.value = options.length > 0 ? options[0].value : ''; // Sélectionner le premier élément par défaut

    
    supportBlade.on('change', async (ev: { value: any }) => {
      // Gérer le changement dans la liste déroulante

      let tnFinded: TreeNode = null;
      if (!SpecialityEquipmentNodes) return;

      const selectedElementId = ev.value;
      const selectedOption = options.find(
        (opt) => opt.value === selectedElementId
      );
      const selectedComment = selectedOption
        ? selectedOption.text
        : 'Aucun support sélectionné';
      const selectedImageUrl = selectedOption ? selectedOption.image_url : '';

      if (selectedElementId === 'null') {
        console.log('Veuillez sélectionner un support valide.');
        // Désactiver le toggle en le mettant sur "false"
        paramCheckCoordinates.toggle = false;
        folderCoordinates.refresh(); // Rafraîchir l'affichage pour refléter la nouvelle valeur        return;
        updateButtonWithUrl(null);
        updateImage(''); // Effacer l'image
      } else {
        console.log('Element ID sélectionné:', selectedElementId);
        console.log('Commentaire sélectionné:', selectedComment);
        // Rechercher dans cette liste le TreeNode avec l'elementId correspondant.
        console.time('Recherche dans Map');
        tnFinded = treeNodeSEqMap.get(selectedElementId);
        console.timeEnd('Recherche dans Map');
        updateImage(selectedImageUrl); // Mettre à jour l'image
      }

      if (tnFinded) {
        _treeNodeSelected = tnFinded;
        console.log('____');
        //console.log(_treeNodeSelected);
        RefreshTreeNodeSelected();
        //const id = tnFinded.model.id;
      } else {
        console.log(
          `Impossible de trouver le node pour l'elementid ${selectedElementId}`
        );
      }
    });

    // Initialiser l'image avec la première option si elle existe
    if (options.length > 0 && options[0].image_url) {
      updateImage(options[0].image_url);
    }
  }

  // Appeler la fonction pour remplir la liste déroulante au chargement
  populateDropdown();

  folderCoordinates.addBlade({
    view: 'separator',
  });

  elementIdLabel = folderCoordinates.addBlade({
    view: 'text',
    label: 'elementId',
    parse: (v) => String(v),
    value: 'select support',
    disabled: true,
  });

  btnUrlDoc = folderCoordinates
    .addButton({
      title: '...',
      disabled: true,
      label: 'url', // optional
    })
    .on('click', () => {
      // L'action de clic initial est vide, car l'URL sera mise à jour plus tard
    });

  const REVIT_COORDINATES = {
    x: 0,
    y: 0,
    z: 0,
  };

  const _xRevitGPS = folderCoordinates.addBinding(REVIT_COORDINATES, 'x', {
    format: (v) => v.toFixed(3),
    label: 'x(Revit)',
    disabled: true,
  });

  const _yRevitGPS = folderCoordinates.addBinding(REVIT_COORDINATES, 'y', {
    format: (v) => v.toFixed(3),
    label: 'y(Revit)',
    disabled: true,
  });
  const _zRevitGPS = folderCoordinates.addBinding(REVIT_COORDINATES, 'z', {
    format: (v) => v.toFixed(3),
    label: 'z(Revit)',
    disabled: true,
  });

  //#endregion

  //#region folderMesurements
  folderMesurements
    .addBinding(measurementsParams, 'enabled', {
      label: 'Enabled',
    })
    .on('change', () => {
      measurementsExtension.enabled = measurementsParams.enabled;
    });
  folderMesurements
    .addBinding(measurementsParams, 'visible', {
      label: 'Visible',
    })
    .on('change', () => {
      measurementsExtension.options = measurementsParams;
    });
  folderMesurements
    .addBinding(measurementsParams, 'type', {
      label: 'Type',
      options: {
        PERPENDICULAR: MeasurementType.PERPENDICULAR,
        POINTTOPOINT: MeasurementType.POINTTOPOINT,
      },
    })
    .on('change', () => {
      measurementsExtension.options = measurementsParams;
    });
  folderMesurements
    .addBinding(measurementsParams, 'vertexSnap', {
      label: 'Snap',
    })
    .on('change', () => {
      measurementsExtension.options = measurementsParams;
    });

  folderMesurements
    .addBinding(measurementsParams, 'units', {
      label: 'Units',
      options: Units,
    })
    .on('change', () => {
      measurementsExtension.options = measurementsParams;
    });
  folderMesurements
    .addBinding(measurementsParams, 'precision', {
      label: 'Precision',
      step: 1,
      min: 1,
      max: 5,
    })
    .on('change', () => {
      measurementsExtension.options = measurementsParams;
    });
  folderMesurements
    .addButton({
      title: 'Delete',
    })
    .on('click', () => {
      measurementsExtension.removeMeasurement();
    });
  folderMesurements
    .addButton({
      title: 'Delete All',
    })
    .on('click', () => {
      measurementsExtension.clearMeasurements();
    });
  //#endregion

  async function getAltitudeFromOpenElevation(
    lat: number,
    lng: number
  ): Promise<number | null> {
    try {
      const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;

      const response = await axios.get(url);

      if (response.status === 200 && response.data.results.length > 0) {
        const altitude = response.data.results[0].elevation;
        console.log(`Altitude à (${lat}, ${lng}) : ${altitude} mètres`);
        return altitude;
      } else {
        console.log("Erreur lors de la récupération de l'altitude");
        return null;
      }
    } catch (error) {
      console.error("Erreur lors de la récupération de l'altitude :", error);
      return null;
    }
  }

  async function getElevationFromSwagger(
    lat: number,
    lng: number
  ): Promise<number | null> {
    try {
      // Construction de l'URL pour la requête à l'API Géoportail
      const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${lng}&lat=${lat}&resource=ign_rge_alti_wld&delimiter=|&indent=false&measures=false&zonly=false`;
      // Envoi de la requête GET à l'API
      const response = await axios.get(url);

      // Vérification de la réponse et extraction de l'altitude
      if (
        response.status === 200 &&
        response.data &&
        response.data.elevations &&
        response.data.elevations.length > 0
      ) {
        const elevationData = response.data.elevations[0];
        const altitude = elevationData.z;
        console.log(`Altitude à (${lat}, ${lng}) : ${altitude} mètres`);
        return altitude;
      } else {
        console.log("Erreur lors de la récupération de l'altitude");
        return null;
      }
    } catch (error) {
      console.error("Erreur lors de la récupération de l'altitude :", error);
      return null;
    }
  }

  function initializeExtensions(viewer: Viewer) {
    /** Add the stock camera controller extension */
    const cameraController = viewer.createExtension(CameraController);

    /** Add the selection extension for extra interactivity */
    const selection = viewer.createExtension(SelectionExtension);
    //viewer.createExtension(BoxSelection);

    /** Add mesurements extension */
    const measurements = viewer.createExtension(MeasurementsExtension);
    measurements.enabled = false;

    const measurementsExtension = viewer.getExtension(
      MeasurementsExtension
    ) as MeasurementsExtension;

    /** Add our extended selection extension */
    //const extendedSelection = viewer.createExtension(ExtendedSelection);

    /** Add our custom extension */
    const moveExtension = viewer.createExtension(MoveExtended);

    /** Add filteringExtension */
    const filtering = viewer.createExtension(FilteringExtension);

    return {
      cameraController,
      selection,
      measurements,
      measurementsExtension,
      moveExtension,
      filtering,
    };
  }

  //Fonction pour charger les urls Speckle
  async function loadSpeckleObjects(
    urls: string[],
    viewer: Viewer,
    spinnerContainer: HTMLElement | null
  ): Promise<void> {
    if (spinnerContainer) {
      spinnerContainer.style.display = 'block';
    }
    try {
      const loadPromises = urls.map((url) => {
        const loader = new SpeckleLoader(viewer.getWorldTree(), url, '');
        return viewer.loadObject(loader, true);
      });
      await Promise.all(loadPromises);
    } catch (error) {
      console.error('Erreur de chargement des données : ', error);
      // Afficher une notification ou un message d'erreur à l'utilisateur
    } finally {
      if (spinnerContainer) {
        spinnerContainer.style.display = 'none';
      }
    }
  }

  // Fonction pour prendre une capture d'écran
  async function takeScreenshot() {
    try {
      // Attendre la capture d'écran
      const screenshotBase64 = await viewer.screenshot();

      // Copier la capture d'écran dans le presse-papiers
      await copyToClipboard(screenshotBase64);

      // Ouvrir l'image dans un nouvel onglet
      //openInNewTab(screenshotBase64);
      // Télécharger l'image automatiquement
      downloadImage(screenshotBase64, 'screenshot.png');
    } catch (error) {
      console.error('Failed to take screenshot:', error);
    }
  }

  // Fonction pour copier l'image base64 dans le presse-papiers
  async function copyToClipboard(base64) {
    const image = new Image();
    image.src = base64;

    // Une fois l'image chargée, la convertir en Blob pour le presse-papiers
    image.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context!.drawImage(image, 0, 0);

      // Convertir le canvas en Blob
      canvas.toBlob(async (blob) => {
        try {
          // Copier l'image dans le presse-papiers
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          console.log('Image copied to clipboard!');
        } catch (error) {
          console.error('Failed to copy image to clipboard:', error);
        }
      }, 'image/png');
    };
  }

  // Fonction pour télécharger l'image automatiquement
  function downloadImage(base64, filename) {
    const link = document.createElement('a');
    link.href = base64;
    link.download = filename;

    // Simuler un clic pour déclencher le téléchargement
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Fonction pour Zoomer sur un TreeNode
  function ZoomOnTreeNode(targetTreeNode: TreeNode): void {
    selection.clearSelection();
    const ids = [targetTreeNode.model.id];
    selection.selectObjects(ids);
    cameraController.setCameraView(ids, true);
    // Accéder aux propriétés brutes de l'élément sélectionné
    const properties = targetTreeNode.model.raw;

    const parameterUrl: Param | null = findParameterByName(
      properties,
      'URL_PANO'
    );

    // Mettre à jour le bouton avec le nouveau paramètre URL_DOC trouvé
    updateButtonWithUrlForPano(parameterUrl);
  }

  //Fonction pour rechercher le typeRevitSpeckle à partir de son elementId
  function findTypeRevitSpeckleByElementId(
    /*
    Récolte les coordonnées Box3 des éléments Speckle et leur différences
    avec celles de Revit
    type TypeRevitSpeckle = {
      node: TreeNode;
      currentCenter: Vector3;
      transformations: Vector3;
      batchObjects: BatchObject[]; // Liste des objets batch associés
    };
    */

    targetTypeRevitSpeckles: TypeRevitSpeckle[],
    elementIdToSearch: string
  ): TypeRevitSpeckle | undefined {
    return targetTypeRevitSpeckles.find(
      (item) => item.node.model.raw.elementId === elementIdToSearch
    );
  }

  //Function to Move current TreeNode
  function MoveTreeNode() {
    if (!_treeNodeSelected) return;
    const currentElementId = _treeNodeSelected.model.raw.elementId;
    if (!currentElementId) return;
    if (!typeRevitSpeckles) return;

    // Affichage des centres de chaque boîte englobante avec window.alert
    // Vérifier si SpecialityEquipmentNodes est vide ou null
    if (typeRevitSpeckles) {
      // Trouver le TypeRevitSpeckle correspondant à l'élément sélectionné
      const foundTypeRevitSpeckle = findTypeRevitSpeckleByElementId(
        typeRevitSpeckles,
        currentElementId
      );

      // Affichage des TreeNodes trouvés
      //console.log(`Number of filteredNode with elementId ${elementIdToSearch} is ${filteredNodes.length}`);
      if (foundTypeRevitSpeckle) {
        /*      
          node: TreeNode;
          currentCenter: Vector3;
          transformations: Vector3;
          batchObjects: BatchObject[]; // Liste des objets batch associés
        */
        const tn: TreeNode = foundTypeRevitSpeckle.node;
        const currentCenter = foundTypeRevitSpeckle.currentCenter;
        const lastTransformation = foundTypeRevitSpeckle.transformations;

        /*calcul du vecteur de déplacement par rapport à la position speckle
        de  l'objet sélectionné
        */
        const newPosition = new Vector3(
          REVIT_COORDINATES.x,
          REVIT_COORDINATES.y,
          REVIT_COORDINATES.z
        );

        const translation = new Vector3(
          REVIT_COORDINATES.x - currentCenter.x,
          REVIT_COORDINATES.y - currentCenter.y,
          REVIT_COORDINATES.z - currentCenter.z
        );

        if (isNaN(translation.x)) {
          translation.x = 0;
        }
        if (isNaN(translation.y)) {
          translation.y = 0;
        }
        if (isNaN(translation.z)) {
          translation.z = 0;
        }

        lastTransformation.add(translation);
        /*
          node: TreeNode;
          currentCenter: Vector3;
          transformations: Vector3;
          batchObjects: BatchObject[]; // Liste des objets batch associés
        */

        foundTypeRevitSpeckle.batchObjects.forEach(
          (batchObject: BatchObject) => {
            batchObject.transformTRS(
              lastTransformation,
              undefined,
              undefined,
              undefined
            );
          }
        );

        /*
        moveExtension.MoveTreeNode(
          _treeNodeSelected,
          translation,
          currentCenter
        );
        */

        viewer.requestRender();

        /*
        type TypeRevitSpeckle = {
          node: TreeNode;
          currentCenter: Vector3;
          transformations: Vector3;
          batchObjects: BatchObject[]; // Liste des objets batch associés
        };
        */
        const foundIndex = typeRevitSpeckles.findIndex(
          (item) => item.node.model.raw.elementId === currentElementId
        );
        if (foundIndex !== -1) {
          //MAJ du foundTypeRevitSpeckle
          typeRevitSpeckles[foundIndex].currentCenter = lastTransformation;
        }

        typeRevitSpeckles.forEach((item, index) => {
          if (item.node.model.raw.elementId != currentElementId) return;
          console.group('After moving :');
          console.log('Node elementid :', item.node.model.raw.elementId);
          console.log(
            'Current Center after translation is :',
            item.currentCenter
          );
          console.groupEnd();
        });
      } else {
        console.log(
          `No TypeRevitSpeckle found with elementId ${currentElementId}`
        );
      }
    }
  }

  // Fonction pour rechercher récursivement une propriété dans un objet
  function GetMatrix4(properties: { [key: string]: any }): any | null {
    // Vérifier si la propriété "parameters" existe
    if (properties.hasOwnProperty('transform')) {
      const transforms = properties['transform'];

      // Parcourir chaque clé dans 'parameters'
      for (const key in transforms) {
        if (transforms.hasOwnProperty(key)) {
          const param = transforms[key];
          if (param && typeof param === 'object') {
            //c'est matrix!
            return param;
          }
        }
      }
    }
    return null; // Retourner null si la propriété recherchée n'est pas trouvée
  }

  // Fonction pour rechercher récursivement une propriété dans un objet
  function findParameterByName(
    properties: { [key: string]: any },
    propertyName: string
  ): Param | null {
    // Vérifier si la propriété "parameters" existe
    if (properties.hasOwnProperty('parameters')) {
      const parameters = properties['parameters'];

      // Parcourir chaque clé dans 'parameters'
      for (const key in parameters) {
        if (parameters.hasOwnProperty(key)) {
          const param = parameters[key];

          // Vérifiez si la propriété 'name' de 'param' correspond à 'propertyName'
          if (
            param &&
            typeof param === 'object' &&
            param.name === propertyName
          ) {
            const foundParam: Param = {
              id: param.id || '',
              name: param.name || '',
              units: param.units || 0,
              value: param.value || '',
              speckletype: param.speckle_type || '',
            };
            return foundParam;
          }
        }
      }
    }
    return null; // Retourner null si la propriété recherchée n'est pas trouvée
  }

  // Fonction pour mettre à jour le bouton avec le paramètre URL_DOC trouvé
  function updateButtonWithUrl(parameterUrl: Param | null) {
    if (btnUrlDoc) {
      btnUrlDoc.dispose(); // Disposer du bouton précédent pour nettoyer les événements

      if (parameterUrl) {
        if (parameterUrl.value && parameterUrl.value.trim() !== '') {
          btnUrlDoc = folderCoordinates
            .addButton({
              title: '...',
              disabled: false,
              index: 1,
              label: 'url',
            })
            .on('click', () => {
              window.open(parameterUrl.value, '_blank'); // Ouvre l'URL dans un nouvel onglet
            });
        } else {
          btnUrlDoc = folderCoordinates.addButton({
            title: '...',
            disabled: true,
            index: 1,
            label: 'url',
          });
        }
      } else {
        btnUrlDoc = folderCoordinates.addButton({
          title: '...',
          disabled: true,
          index: 1,
          label: 'url',
        });
      }
    }
  }

  function updateButtonWithUrlForPano(parameterUrl: Param | null) {
    if (btnUrlPano) {
      btnUrlPano.dispose(); // Disposer du bouton précédent pour nettoyer les événements

      if (parameterUrl) {
        if (parameterUrl.value && parameterUrl.value.trim() !== '') {
          btnUrlPano = folderTools
            .addButton({
              title: '...',
              disabled: false,
              index: 6,
              label: 'url',
            })
            .on('click', () => {
              window.open(parameterUrl.value, '_blank'); // Ouvre l'URL dans un nouvel onglet
            });
        } else {
          btnUrlPano = folderTools.addButton({
            title: '...',
            disabled: true,
            index: 6,
            label: 'url',
          });
        }
      } else {
        btnUrlPano = folderTools.addButton({
          title: '...',
          disabled: true,
          index: 6,
          label: 'url',
        });
      }
    }
  }

  /* Fonction qui va alimenter une liste de TypeRevitSpeckle
  node est le TreeNode Speckle correspondant
  centerBoxSpeckle est le centre de la Bbox3 (union de tous les batchObject du TreeNode Speckle) 
  diffVectorSpeckleRevit est la différence qu'il y a entre : 
    - le centre de la Box3 de Speckle
    - les coordonnées issues de Revit (vraies GPS)
  */
  function getTypeRevitSpeckles(nodes: TreeNode[]): TypeRevitSpeckle[] {
    // Fonction pour arrondir à trois décimales et remplacer les petites valeurs par zéro
    const roundAndSanitizeValue = (
      num: number,
      decimals: number = 3
    ): number => {
      const factor = Math.pow(10, decimals);
      const rounded = Math.round(num * factor) / factor;
      const EPSILON = 1e-10; // Tolérance pour définir les très petites valeurs comme zéro
      return Math.abs(rounded) < EPSILON ? 0 : rounded;
    };

    /*
    type TypeRevitSpeckle = {
      node: TreeNode;
      currentCenter: Vector3;
      batchObjects: BatchObject[]; // Liste des objets batch associés
    };
    */
    // Liste pour stocker les boîtes englobantes de chaque batchObject
    const revitSpeckleType: TypeRevitSpeckle[] = [];
    const renderer = viewer.getRenderer();
    const renderTree = viewer.getWorldTree().getRenderTree();

    // Parcourir chaque TreeNode de la liste
    nodes.forEach((node: TreeNode) => {
      //obtention des coordonnées issues de Revit
      const matrix4: any | null = GetMatrix4(node.model.raw);
      let currentVector: Vector3 = new Vector3();

      if (matrix4) {
        currentVector = new Vector3(
          roundAndSanitizeValue(matrix4[3]),
          roundAndSanitizeValue(matrix4[7]),
          roundAndSanitizeValue(matrix4[11])
        );
      }

      //Obtention de la liste de tous les batchObject du TreeNode
      const batchObjects: BatchObject[] = [];

      // Obtenir les vues de rendu pour ce nœud
      const rvs = renderTree.getRenderViewsForNode(node);
      // Parcourir chaque vue de rendu
      rvs.forEach((rv: NodeRenderView) => {
        // Obtenir le batchObject à partir de la vue de rendu
        const batchObject = renderer.getObject(rv);
        // Si le batchObject existe, unionner sa boîte englobante à la boîte englobante du nœud
        if (batchObject) {
          batchObjects.push(batchObject);
        }
      });

      console.groupCollapsed(node.model.raw.elementId);
      console.log('currentVector');
      console.log(currentVector);
      console.log('BatchObjects are', batchObjects);
      console.log('________');
      console.groupEnd();

      /*
      type TypeRevitSpeckle = {
        node: TreeNode;
        currentCenter: Vector3;
        batchObjects: BatchObject[]; // Liste des objets batch associés
      };
      */

      // Ajout du TreeNode et de sa boîte englobante au tableau
      revitSpeckleType.push({
        node,
        transformations: new Vector3(),
        currentCenter: currentVector,
        batchObjects: batchObjects,
      });
    });

    return revitSpeckleType;
  }

  // Fonction évènement la projection à changé du cameraController
  cameraController.on(CameraEvent.ProjectionChanged, () => {
    console.log('ProjectionChanged');
  });

  // Fonction pour obtenir un TreeNode par ID
  function RefreshTreeNodeSelected(): void {
    _xRevitGPS.disabled = true;
    _yRevitGPS.disabled = true;
    _zRevitGPS.disabled = true;

    // Fonction pour arrondir à trois décimales et remplacer les petites valeurs par zéro
    const roundAndSanitizeValue = (
      num: number,
      decimals: number = 3
    ): number => {
      const factor = Math.pow(10, decimals);
      const rounded = Math.round(num * factor) / factor;
      const EPSILON = 1e-10; // Tolérance pour définir les très petites valeurs comme zéro
      return Math.abs(rounded) < EPSILON ? 0 : rounded;
    };

    //vérifications préliminaires
    if (!_treeNodeSelected) return;
    const currentElementId = _treeNodeSelected.model.raw.elementId;
    if (!currentElementId) return;

    const treeNodeData: NodeData = _treeNodeSelected.model;
    // Accéder aux propriétés brutes de l'élément sélectionné
    const properties = treeNodeData.raw;

    const parameterUrl: Param | null = findParameterByName(
      properties,
      'URL_DOC'
    );

    // Mettre à jour le bouton avec le nouveau paramètre URL_DOC trouvé
    updateButtonWithUrl(parameterUrl);

    /*
    Seuls les objets présents dans la liste TypeRevitSpeckle[] peuvent se mouvoir
    Ici je dois aller chercher si le _treeNodeSelected sélectionné 
    est présent dans la liste TypeRevitSpeckle
      * S'il n'est pas présent, je vais afficher les coordonnées mais son
      déplacement reste impossible
      * S'il est présent, j'affiche les coordonnées issues de la liste
      
      TypeRevitSpeckle
      {
        node est le TreeNode Speckle correspondant
        currentCenter: Vector3; position actuelle du TreeNode
        batchObjects: BatchObject[]; // Liste des objets batch associés
      }      
    */

    // Trouver le TypeRevitSpeckle correspondant à l'élément sélectionné
    const foundTypeRevitSpeckle = findTypeRevitSpeckleByElementId(
      typeRevitSpeckles,
      currentElementId
    );

    // Affichage des TreeNodes trouvés
    //console.log(`Number of filteredNode with elementId ${elementIdToSearch} is ${filteredNodes.length}`);

    if (foundTypeRevitSpeckle) {
      const currentCenter = foundTypeRevitSpeckle.currentCenter;

      REVIT_COORDINATES.x = roundAndSanitizeValue(currentCenter.x);
      REVIT_COORDINATES.y = roundAndSanitizeValue(currentCenter.y);
      REVIT_COORDINATES.z = roundAndSanitizeValue(currentCenter.z);
    } else {
      const matrix4: any | null = GetMatrix4(properties);
      if (matrix4) {
        // Assainir et assigner les coordonnées Revit
        REVIT_COORDINATES.x = roundAndSanitizeValue(matrix4[3]);
        REVIT_COORDINATES.y = roundAndSanitizeValue(matrix4[7]);
        REVIT_COORDINATES.z = roundAndSanitizeValue(matrix4[11]);
      }
    }

    elementIdLabel.value = currentElementId;
    _xRevitGPS.refresh();
    _yRevitGPS.refresh();
    _zRevitGPS.refresh();

    console.log(`elemenid sélectionné ${currentElementId}`);
  }

  viewer.on(ViewerEvent.ObjectClicked, (selectionEvent: SelectionEvent) => {
    //https://speckle.community/t/rotating-object-and-unable-to-click/8516
    if (selectionEvent && selectionEvent.hits) {
      //http://speckle.guide/viewer/viewer-api.html#selectionevent

      const treeNode: TreeNode = selectionEvent.hits[0].node;
      _treeNodeSelected = treeNode;
      RefreshTreeNodeSelected();
    }
  });

  async function fetchSpecificDataForElementId(
    elementId: number
  ): Promise<any> {
    try {
      console.log(
        'Début de la récupération des données pour elementId:',
        elementId
      );

      const dbRef = ref(database, 'elements'); // Référence au tableau 'elements' dans Firebase
      const snapshot = await get(dbRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        //console.log("Données brutes récupérées depuis Firebase:", data);

        // Vérifier que l'élément avec l'elementId existe dans le tableau
        for (const item of data) {
          if (item && Number(item.elementid) === Number(elementId)) {
            /*
            console.log(
              "Correspondance trouvée pour elementId:",
              elementId,
              "Données:",
              item
            );
            */
            return item; // Retourne les données correspondantes
          }
        }

        console.log(`Aucune donnée trouvée pour elementId ${elementId}`);
        return null;
      } else {
        console.log('Aucune donnée disponible dans Firebase.');
        return null;
      }
    } catch (error) {
      console.error(
        'Erreur lors de la récupération des données depuis Firebase:',
        error
      );
      return null;
    }
  }

  // Fonction pour obtenir les données depuis Firebase Realtime Database
  async function fetchCommentsAndElementIds(): Promise<
    Record<string, { comment: string; image_url: string }>
  > {
    try {
      console.log('Tentative de récupération des données Firebase');
      const dbRef = ref(database, 'elements');
      const snapshot = await get(dbRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        const commentsList: Record<
          string,
          { comment: string; image_url: string }
        > = {
          null: { comment: 'Aucun support', image_url: '' },
        };

        data.forEach((item: any) => {
          if (item && item.elementid) {
            commentsList[item.elementid] = {
              comment: item.commentaire || '',
              image_url: item.image_url || '',
            };
          }
        });

        console.log('Données brutes récupérées depuis Firebase:', commentsList);
        return commentsList;
      } else {
        console.log('Aucune donnée disponible dans Firebase.');
        return { null: { comment: 'Quel est votre support ?', image_url: '' } };
      }
    } catch (error) {
      console.error(
        'Erreur lors de la récupération des données depuis Firebase:',
        error
      );
      return { null: { comment: 'Quel est votre support ?', image_url: '' } };
    }
  }

  // Fonction pour démarrer l'exécution périodique
  function startFunctionWithInterval() {
    const refreshTime = parseInt(refreshBlade.value, 10); // Assurez-vous que refreshBlade.value est traité comme un nombre

    refreshIntervalId = setInterval(() => {
      console.log(
        "La fonction s'exécute toutes les",
        refreshTime / 1000,
        'secondes'
      );

      // Placez ici la logique de la fonction à exécuter
      GetGPSCoordinatesFromFirebase();
    }, refreshTime) as unknown as number;
  }

  // Fonction pour arrêter l'exécution périodique
  function stopFunctionWithInterval() {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
      console.log('La fonction périodique a été arrêtée');
    }
  }

  // Exemple de la fonction à exécuter périodiquement
  async function GetGPSCoordinatesFromFirebase() {
    console.log('Votre fonction est exécutée');
    const selectedElementId = supportBlade.value; // Récupérer la valeur actuelle de supportBlade

    if (selectedElementId === 'null') {
      console.log('Veuillez sélectionner un support valide.');
      // Désactiver le toggle en le mettant sur "false"
      paramCheckCoordinates.toggle = false;
      folderCoordinates.refresh(); // Rafraîchir l'affichage pour refléter la nouvelle valeur        return;
    } else {
      console.log('Element ID sélectionné:', selectedElementId);
    }

    // Appeler la fonction pour récupérer les données pour l'elementId sélectionné
    const data = await fetchSpecificDataForElementId(Number(selectedElementId));

    // Affichage des données récupérées dans la console
    if (data) {
      try {
        console.log("Données pour l'élément sélectionné:", data);
        // Récupérer la latitude et la longitude
        const lat = data.latitude;
        const lng = data.longitude;

        // Afficher la latitude et la longitude dans la console
        console.log('Latitude:', lat);
        console.log('Longitude:', lng);

        // Votre API Key MapTiler
        maptilersdk.config.apiKey = '0IOxISLhuYyV9WWBRWYR';
        //https://epsg.io/transform#s_srs=4326&t_srs=3947&x=-1.5462300&y=47.2126630
        const projectedCoords = await maptilersdk.coordinates.transform(
          [lng, lat],
          { sourceCrs: 4326, targetCrs: 3947 }
        );
        const results = projectedCoords.results[0];
        
        const x_transformed = (results.x ?? 0).toFixed(3);
        const y_transformed = (results.y ?? 0).toFixed(3); // Utilise 0 si results.y est undefined
        

        /* ON NE RECUPERE PAS LE Z CAR 
        LA TOPO FROM GEOPORTAIL OU AUTRE NE CORRESPOND PAS A CELLE APRES CHANTIER
        DONC ON NE CHANGE PAS LE Z
        
        //const altitudeFromGeoportail = dz; // getAltitudeFromGeoportail(lat, lng);
        const altitudeFromGeoportail = getElevationFromSwagger(lat, lng);

        const z_transformed = (await altitudeFromGeoportail).toFixed(3);
        */
        const z_transformed = dz.toFixed(3);

        // Effectuer les soustractions
        const x_final = (parseFloat(x_transformed) - dx).toFixed(3);
        const y_final = (parseFloat(y_transformed) - dy).toFixed(3);
        const z_final = (parseFloat(z_transformed) - dz).toFixed(3);

        console.log(
          'Coordonnées point de base Revit : x ',
          x_final,
          'y : ',
          y_final,
          'z : ',
          z_final
        );

        //mise à jour des nouvelles coordonnées dans le Pane
        REVIT_COORDINATES.x = parseFloat(x_final);
        REVIT_COORDINATES.y = parseFloat(y_final);
        REVIT_COORDINATES.z = parseFloat(z_final);

        _xRevitGPS.refresh();
        _yRevitGPS.refresh();
        _zRevitGPS.refresh();

        _xRevitGPS.disabled = true;
        _yRevitGPS.disabled = true;
        _zRevitGPS.disabled = true;

        folderCoordinates.refresh(); // Rafraîchir l'affichage pour refléter la nouvelle valeur        return;

        MoveTreeNode();
      } catch (error) {
        console.error(
          'Erreur lors de la transformation des coordonnées :',
          error
        );
      }
    }
    // Ajoutez ici la logique réelle que vous voulez exécuter
  }
}

// Initialisation de Firebase

main();

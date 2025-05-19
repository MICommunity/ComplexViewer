import {Interactor} from "./interactor";
import Point2D from "point2d";
import Intersection from "intersectionjs";
import {svgns} from "../../svgns";

export class Complex extends Interactor {
    constructor(id, app, interactor, interactorRef) {
        super();
        const complexIdMatch = interactorRef.match(/^.*(CPX-[0-9]+).*$/);
        const complexId = complexIdMatch ? complexIdMatch[1] : "";
        this.init(id, app, interactor, complexId);
        this.type = "complex";
        this.upperGroup = document.createElementNS(svgns, "g");
        this.initLabel();
        this.padding = 28;
    }

    initLink(naryLink) {
        this.naryLink = naryLink;
        this.naryLink.path.classList.add("complex-outline");
    }

    setLinked() {
        this.naryLink.path2.classList.add("linked-complex");
    }

    getPosition(originPoint) {
        let mapped = this.naryLink.mapped;
        if (!mapped) {
            this.naryLink.setLinkCoordinates();
            mapped = this.naryLink.mapped;
        }
        const mc = mapped.length;
        let xSum = 0,
            ySum = 0;
        for (let m = 0; m < mc; m++) {
            xSum += mapped[m][0];
            ySum += mapped[m][1];
        }
        let center = [xSum / mc, ySum / mc];
        if (originPoint) {
            let naryPath = this.naryLink.hull;
            let iPath = [];
            for (let p of naryPath) {
                iPath.push(new Point2D(p[0], p[1]));
            }
            let a1 = new Point2D(center[0], center[1]);
            let a2 = new Point2D(originPoint[0], originPoint[1]);
            let intersect = Intersection.intersectLinePolygon(a1, a2, iPath);
            if (intersect.points[0]) {
                return [intersect.points[0].x, intersect.points[0].y];
            }
            this.setLinked();
        }
        return center;
    }

    setPosition () {
        //do nothing
    }

    changePosition (dx, dy) {
        for (let participant of this.naryLink.participants) {
            participant.changePosition(dx, dy);
        }
    }

    setLabelPosition () {
        function getHighestPointFromPath(pathString) {
            const commands = pathString.match(/[a-df-z][^a-df-z]*/ig);
            let currentPoint = [0, 0];
            let highestPoint = null;

            const updateHighest = (x, y) => {
                if (!highestPoint || y < highestPoint[1]) {
                    highestPoint = [x, y];
                }
            };

            commands.forEach(cmd => {
                const type = cmd[0];
                const args = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

                switch (type) {
                    case "M":
                    case "L":
                        for (let i = 0; i < args.length; i += 2) {
                            const [x, y] = [args[i], args[i + 1]];
                            updateHighest(x, y);
                            currentPoint = [x, y];
                        }
                        break;
                    case "C":
                        for (let i = 0; i < args.length; i += 6) {
                            const [x1, y1, x2, y2, x, y] = args.slice(i, i + 6);
                            updateHighest(x1, y1);
                            updateHighest(x2, y2);
                            updateHighest(x, y);
                            currentPoint = [x, y];
                        }
                        break;
                    case "Q":
                        for (let i = 0; i < args.length; i += 4) {
                            const [x1, y1, x, y] = args.slice(i, i + 4);
                            updateHighest(x1, y1);
                            updateHighest(x, y);
                            currentPoint = [x, y];
                        }
                        break;
                    case "H":
                        for (const x of args) {
                            updateHighest(x, currentPoint[1]);
                            currentPoint[0] = x;
                        }
                        break;
                    case "V":
                        for (const y of args) {
                            updateHighest(currentPoint[0], y);
                            currentPoint[1] = y;
                        }
                        break;
                    // Add more cases as needed for other commands
                }
            });

            return highestPoint;
        }

        const pathString = this.naryLink.path.getAttribute("d");
        const highestPoint = getHighestPointFromPath(pathString);
        if (highestPoint) {
            this.upperGroup.setAttribute("transform", `translate(${highestPoint[0]} ${highestPoint[1]})`);
        }
    }

    getResidueCoordinates () {
        return this.getPosition();
    }

    setAllLinkCoordinates() {
        this.setLabelPosition();
        super.setAllLinkCoordinates();
    }
}

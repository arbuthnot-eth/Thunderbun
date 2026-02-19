import ThunderBunEvent from "./event";

type IdData = { id: number };
type ResizeData = {
	id: number;
	x: number;
	y: number;
	width: number;
	height: number;
};
type MoveData = { id: number; x: number; y: number };

export default {
	close: (data: IdData) => new ThunderBunEvent<IdData, {}>("close", data),
	resize: (data: ResizeData) =>
		new ThunderBunEvent<ResizeData, {}>("resize", data),
	move: (data: MoveData) => new ThunderBunEvent<MoveData, {}>("move", data),
	focus: (data: IdData) => new ThunderBunEvent<IdData, {}>("focus", data),
};

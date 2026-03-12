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
type KeyData = { id: number; keyCode: number; modifiers: number; isRepeat: boolean };

export default {
	close: (data: IdData) => new ThunderBunEvent<IdData, {}>("close", data),
	resize: (data: ResizeData) =>
		new ThunderBunEvent<ResizeData, {}>("resize", data),
	move: (data: MoveData) => new ThunderBunEvent<MoveData, {}>("move", data),
	focus: (data: IdData) => new ThunderBunEvent<IdData, {}>("focus", data),
	blur: (data: IdData) => new ThunderBunEvent<IdData, {}>("blur", data),
	keyDown: (data: KeyData) => new ThunderBunEvent<KeyData, {}>("keyDown", data),
	keyUp: (data: KeyData) => new ThunderBunEvent<KeyData, {}>("keyUp", data),
};
